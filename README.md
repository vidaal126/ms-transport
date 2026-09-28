# ms-transport

Microsserviço de transporte (NestJS, Prisma, PostgreSQL, Kafka):

- **Kafka**: consumer de `catalog.ItemCreated` que mantém o read model
  `catalog_items` com o que transporte precisa de cada item (peso e dimensões).
- **Tipos de transporte**: dono do `TransportType` (CRUD via HTTP), com os
  eventos `transport.TransportTypeCreated` e `transport.TransportTypeUpdated`
  publicados via Transactional Outbox. O ms-customer e o ms-sales-order mantêm
  réplicas a partir deles.
- **HTTP**: tipos de transporte, leitura do read model e health checks.

## Arquitetura

Camadas hexagonais, com dependências apontando para dentro:

- `src/domain`: `CatalogItem` (mesmas invariantes físicas do ms-catalog),
  value object `Dimensions` e erros de domínio. Não depende de Nest, Prisma nem
  Kafka.
- `src/application`: use cases `SyncCatalogItem` e `GetCatalogItem`, sem
  dependência de Nest, e os ports em `application/ports`:
  - `SyncCatalogItemPort`: port de entrada, recebe o evento já decodificado;
  - `ICatalogItemRepository`: port do read model;
  - `DeadLetterPort`: publicação na DLT.
- `src/infrastructure`: adapter Kafka (decoder Zod, consumer, DLT), adapter
  Prisma, HTTP e health checks. A composição dos use cases fica em
  `CatalogSyncModule` (`useFactory`). `MessagingModule` é próprio deste
  serviço: nenhum código é compartilhado com o ms-catalog; o contrato é o
  formato do evento.

### Consumo de `catalog.ItemCreated`

- **Consumer group** `ms-transport.catalog-item-sync` (`CATALOG_SYNC_GROUP_ID`),
  com `fromBeginning: true`: sem offset commitado, lê o tópico inteiro e
  constrói o read model. O group id é fixo; nunca é gerado a cada start.
- **Formatos aceitos** (migração expand/contract):
  - envelope v2: `eventId`, `eventType`, `schemaVersion`, `occurredAt`,
    `aggregateId`, `correlationId` e `payload`;
  - v1 antigo: `schemaVersion: 1` dentro do payload, sem `eventId`.
- **eventId de eventos v1**: UUID v5 sobre `tópico:partição:offset`, com um
  namespace fixo do serviço. É determinístico para a mesma mensagem, então o
  replay é seguro (veja as limitações).
- **Idempotência**: o `eventId` entra em `processed_events` e o item é gravado
  em `catalog_items` na mesma transação. Evento já processado bate na PK de
  `processed_events`: é ignorado, logado em debug e o offset é commitado.
- **Reordenação**: o upsert só sobrescreve se o `occurredAt` do evento for
  mais recente que o `sourceOccurredAt` gravado. Evento mais antigo ou igual é
  registrado como processado e descartado (`stale`).
- **Commit de offset**: `autoCommit: false`. O único commit é o explícito de
  `offset + 1`, feito somente depois de um destes:
  - commit da transação Prisma;
  - ack da publicação na DLT;
  - detecção de duplicata.

  Nenhum caminho commita antes da persistência.
- **correlationId**: o do envelope vai para os logs do processamento. Sem
  envelope v2, vale o header `correlationId` da mensagem, ou um gerado.

### Erros

| Tipo | Exemplos | Tratamento |
|---|---|---|
| Não recuperável | JSON inválido, schema Zod, `schemaVersion` não suportada, invariante de domínio, evento legado sem peso e dimensões, dado rejeitado pelo banco (SQLSTATE classe 22 ou 23, por exemplo CHECK) | publica em `catalog.ItemCreated.DLT` com os bytes originais; commita o offset só depois do ack da DLT |
| Recuperável | banco indisponível, timeout, erro de conexão, erro não classificado | não commita e não manda para a DLT; retry em processo (veja abaixo) |

Retry de erro recuperável:

1. Nova tentativa com backoff exponencial e jitter, com heartbeat entre as
   tentativas. Limite em `CONSUMER_RETRY_RETRIES`.
2. Esgotado o limite, o consumer faz `seek` de volta para a mesma mensagem e
   pausa a partição (`consumer.pause`). O readiness fica `down`.
3. Depois de `CONSUMER_PAUSE_MS`, a partição é retomada a partir da mesma
   mensagem, e o ciclo recomeça se o erro persistir.

O erro do handler nunca chega ao KafkaJS: não há crash-loop do consumer e
nenhuma mensagem é pulada por erro transitório. Duas situações de rebalance têm
tratamento próprio:

- falha no commit do offset: a mensagem já foi persistida (ou foi para a DLT),
  então o erro é só logado; se ela for reentregue, cai no caminho de duplicata;
- falha no heartbeat durante o backoff: o erro sobe de propósito para o
  KafkaJS, que refaz o join sem avançar a mensagem (engolir o erro deixaria um
  commit posterior passar por cima dela). Um SIGTERM durante o backoff interrompe a espera
sem commit; a mensagem volta no próximo start.

Headers da DLT: `dlt-reason`, `dlt-detail`, `dlt-source-topic`,
`dlt-source-partition`, `dlt-source-offset`, `dlt-source-timestamp` e
`dlt-failed-at`, além dos headers originais.

## Como subir

O ambiente compartilhado (Postgres com os databases `catalog` e `transport`,
Kafka, Kafka UI e os dois serviços) fica no repositório irmão
[`../ms-platform`](../ms-platform/README.md).

### Tudo em container

```bash
cd ../ms-platform && docker compose up -d --build
```

O ms-transport fica em http://localhost:3001. O job `transport-migrate` aplica
as migrations antes do app subir.

### No host

```bash
(cd ../ms-platform && docker compose up -d postgres kafka kafka-init kafka-ui)
cp .env.example .env
yarn install
yarn prisma migrate deploy
yarn start
```

O projeto fixa Yarn 1 (`packageManager: yarn@1.22.22`, `yarn.lock` v1).

### Migrations de `transport_types`

A migration `evolve_transport_types_and_outbox` substituiu o par antigo
`drop_transport_types` + `restore_transport_types_and_outbox`, que apagava a
tabela e a recriava vazia. Agora ela altera `transport_types` preservando as
linhas (remove `dailyCapacity` e `usedToday`, adiciona `description`), cria
`outbox_events` e grava um `TransportTypeCreated` por tipo já existente
(`correlationId = migration-backfill`), para que as réplicas do ms-customer e do
ms-sales-order recebam os tipos anteriores ao outbox.

Um banco local que já aplicou o par antigo precisa ser recriado: o histórico
em `_prisma_migrations` não bate mais com o diretório de migrations e o
`prisma migrate deploy` falha.

## Variáveis de ambiente

Validadas com Zod no bootstrap; a aplicação não sobe com env inválida.

| Variável | Padrão | Descrição |
|---|---|---|
| `DATABASE_URL` | obrigatória | URL `postgresql://` |
| `KAFKA_BROKER` | obrigatória | lista `host:porta`; `localhost:9092` no host, `kafka:29092` em container |
| `NODE_ENV` | `development` | `production` desliga o pino-pretty |
| `PORT` | `3001` | porta HTTP (8080 na imagem Docker) |
| `LOG_LEVEL` | `info` | nível do Pino |
| `KAFKA_CLIENT_ID` | `ms-transport` | client id do KafkaJS |
| `KAFKA_SEND_TIMEOUT_MS` | `5000` | teto de cada envio ao Kafka (outbox e DLT; conta como falha) |
| `CATALOG_SYNC_GROUP_ID` | `ms-transport.catalog-item-sync` | consumer group do sync; sobrescreva só para replay com group temporário |
| `CONSUMER_RETRY_RETRIES` | `5` | novas tentativas por mensagem antes de pausar a partição |
| `CONSUMER_RETRY_INITIAL_MS` / `CONSUMER_RETRY_MAX_MS` | `300` / `30000` | backoff exponencial com jitter |
| `CONSUMER_PAUSE_MS` | `30000` | tempo de pausa da partição antes de retomar |
| `THROTTLE_DEFAULT_TTL_MS` / `THROTTLE_DEFAULT_LIMIT` | `60000` / `100` | rate limit HTTP |
| `HEALTH_CHECK_TIMEOUT_MS` | `1500` | timeout de cada checagem do readiness |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | teto do graceful shutdown |

## API HTTP

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/transport-types` | cria (`name` único, `description?`); 409 se o nome existir |
| `PUT` | `/transport-types/:id` | altera `name`, `description` (null limpa) e `active`; sem mudança, não publica evento |
| `GET` | `/transport-types` | lista paginada (`page`, `limit` até 100) com `total` |
| `GET` | `/transport-types/:id` | 404 se não existir |
| `GET` | `/catalog-items/:itemId` | item do read model (400 se não for UUID, 404 se não existir) |
| `GET` | `/health/live` | liveness: não checa dependências |
| `GET` | `/health/ready` | readiness: banco, broker Kafka e consumer (down com a partição pausada ou o consumer degradado) |

## Tópicos e consumer groups

| Tópico | Papel |
|---|---|
| `catalog.ItemCreated` | consumido (publicado pelo ms-catalog) |
| `catalog.ItemCreated.DLT` | publicado: mensagens não recuperáveis, retenção infinita |
| `transport.TransportTypeCreated` | publicado via outbox, key = id do tipo |
| `transport.TransportTypeUpdated` | publicado via outbox a cada mudança real |

Payload dos eventos de tipo de transporte (envelope v2, `schemaVersion: 2`):
`{ id, name, description, active }`, sempre com o estado completo, para as
réplicas guardarem só o último estado.

| Consumer group | Uso |
|---|---|
| `ms-transport.catalog-item-sync` | principal, mantém o read model |
| valor de `CATALOG_SYNC_GROUP_ID` | replay com group temporário |

O broker do compose roda com auto-create desligado: os tópicos vêm do
`kafka-init`. Rodando fora do compose, o ms-transport cria a DLT pelo admin do
KafkaJS se ela não existir; o tópico de eventos precisa existir.

### Inspecionar a DLT

Pela Kafka UI (http://localhost:8090) ou:

```bash
docker compose -f ../ms-platform/docker-compose.yml exec kafka kafka-console-consumer --bootstrap-server kafka:29092 \
  --topic catalog.ItemCreated.DLT --from-beginning --property print.headers=true
```

O header `dlt-reason` diz o motivo, e `dlt-source-*` a posição de origem.

### Replay

Os offsets do group ficam no Kafka, não no banco. A idempotência torna o replay
seguro: evento já processado vira duplicata e evento mais antigo que o gravado
é descartado.

**Opção 1: resetar o group principal.** Pare o ms-transport antes: o reset
falha com o group ativo.

```bash
docker compose -f ../ms-platform/docker-compose.yml exec kafka kafka-consumer-groups --bootstrap-server kafka:29092 \
  --group ms-transport.catalog-item-sync --topic catalog.ItemCreated \
  --reset-offsets --to-earliest --execute
```

**Opção 2: group temporário.** Suba uma instância com um group novo e fixo; o
group principal não é tocado:

```bash
CATALOG_SYNC_GROUP_ID=ms-transport.catalog-item-sync.replay-20260923 yarn start
```

Quando terminar, apague o group temporário:

```bash
docker compose -f ../ms-platform/docker-compose.yml exec kafka kafka-consumer-groups --bootstrap-server kafka:29092 \
  --delete --group ms-transport.catalog-item-sync.replay-20260923
```

Para acompanhar o progresso: `kafka-consumer-groups --describe --group <group>`.

## Testes

```bash
yarn lint              # eslint + typescript-eslint (strictTypeChecked)
yarn typecheck         # tsc --noEmit
yarn test              # unitários
yarn test:integration  # Postgres e Kafka reais (testcontainers)
```

A suíte de integração publica a massa do tópico (2 eventos legados, 1 mensagem
inválida e BOX-001 em v1) e verifica:

- o replay (1 item e 3 mensagens na DLT);
- reenvio de v1 e de v2 sem duplicar;
- proteção contra reordenação;
- poison message indo para a DLT.

Os testes unitários cobrem commit, retry, pausa e retomada do consumer com um
consumer KafkaJS falso. O teste ponta a ponta (catálogo -> read model) fica no
ms-catalog (`yarn test:e2e`).

## Limitações conhecidas

- **Eventos legados sem peso e dimensões** (anteriores ao `schemaVersion: 1`)
  não têm dado para um upcaster reconstruir: vão para a DLT com
  `unsupported_schema_version`.
- **eventId de v1 depende da posição**: o mesmo evento v1 republicado em outro
  offset ganha outro `eventId` e não é tratado como duplicata. Ele entra em
  `processed_events`, mas o guard de `sourceOccurredAt` impede que altere o
  item.
- **Replay republica na DLT** as mensagens não recuperáveis que já estavam lá:
  a DLT acumula cópias de uma mesma mensagem.
- **Entrega at-least-once**: se o commit do offset falhar depois da persistência
  (por exemplo, num rebalance), a mensagem é reprocessada e cai como duplicata.
  Se o commit falhar depois da DLT, a DLT recebe uma cópia a mais.
- **Recriar só o banco não reconstrói o read model**: os offsets do group
  continuam no Kafka (veja "Replay").
- **Erro não classificado é tratado como recuperável**: nunca perde evento, mas
  um erro permanente mantém a partição em ciclos de pausa e retomada até haver
  intervenção. O readiness fica `down` e cada ciclo é logado em error.
- **Invariantes duplicadas**: as regras de peso e dimensões são uma cópia das
  do ms-catalog; mudanças lá precisam ser replicadas aqui.
- **Migração de ambientes antigos**: versões anteriores usavam o group
  `ms-transport.catalog-items` e derivavam o `eventId` de v1 por sha256. O group
  atual (`ms-transport.catalog-item-sync`) começa do início do tópico e os
  eventos v1 ganham novos `eventId` (UUID v5 de tópico+partição+offset). O
  reprocessamento é seguro (o guard de `sourceOccurredAt` descarta como
  `stale`), mas `processed_events` guarda as duas gerações de id e o group
  antigo fica órfão no broker até ser removido manualmente.
- **Rate limit em memória**: vale por réplica. O `trust proxy` confia em
  exatamente 1 salto (o ms-gateway, que anexa o IP do cliente ao
  `X-Forwarded-For`), então o limite conta por cliente e não pelo IP do
  gateway. Acessar o serviço direto, sem o gateway, permite escolher o IP
  contado via `X-Forwarded-For`.
- **Envio com timeout**: o producer tem retries ilimitados (exigência do modo
  idempotente), então cada envio é limitado por `KAFKA_SEND_TIMEOUT_MS`. Um
  envio que estoura o teto conta como falha: no outbox o evento fica pendente
  e é reenviado no próximo tick; na DLT a mensagem de origem não é commitada e
  segue o retry do consumer. Se o envio original ainda completar depois do
  timeout, o destino recebe duplicata (o consumer deduplica pelo `eventId`).
