# ms-transport

Microsserviço de transporte (NestJS, Prisma, PostgreSQL). Roda como aplicação
híbrida:

- **HTTP**: leitura do read model de itens do catálogo e health checks.
- **RabbitMQ**: RPC `check_transport_availability` na fila
  `transport_availability_queue` (disponibilidade de `TransportType`).
- **Kafka**: consumer de `catalog.ItemCreated` que mantém o read model
  `catalog_items` com o que transporte precisa de cada item (peso e dimensões).

## Arquitetura

- `src/domain`: `CatalogItem` (mesmas invariantes físicas do ms-catalog),
  `TransportType`, value object `Dimensions`, erros de domínio e ports de
  repositório.
- `src/application`: use cases `SyncCatalogItem` (entrada do evento) e
  `GetCatalogItem`.
- `src/infrastructure`: adapter Kafka (decoder Zod, consumer, DLT), adapter
  Prisma, HTTP, RabbitMQ e health checks. `MessagingModule` é uma cópia do
  mesmo módulo do ms-catalog.

### Consumo de `catalog.ItemCreated`

- Grupo `ms-transport.catalog-items` com `fromBeginning`: um grupo novo
  reconstrói o read model a partir do histórico do tópico.
- Aceita o envelope v2 (`schemaVersion` no topo) e o formato v1 antigo
  (`schemaVersion: 1` no payload). Eventos v1 não têm `eventId`: é derivado de
  forma determinística (`v1:` + sha256 de `eventType|aggregateId|occurredAt`),
  então reenvios são detectados.
- **Idempotência**: o `eventId` entra em `processed_events` e o item é
  gravado em `catalog_items` na mesma transação. Evento já processado é
  ignorado (log em debug) e o offset é commitado.
- **Reordenação**: o upsert só sobrescreve se o `occurredAt` do evento for
  mais recente que o do registro gravado.
- **Offset**: commitado pelo KafkaJS só depois de o processamento terminar.

### Erros

| Tipo | Exemplos | Tratamento |
|---|---|---|
| Não recuperável | JSON inválido, schema Zod, `schemaVersion` não suportada, invariante de domínio | publica em `catalog.ItemCreated.DLT` com o payload original e commita o offset |
| Recuperável | banco fora, timeout, erro não classificado | não commita; retry exponencial (`CONSUMER_RETRY_*`); esgotado, o consumer crasha, loga em error, fica degradado no readiness e reinicia sozinho |

Headers da DLT: `dlt-reason`, `dlt-detail`, `dlt-source-topic`,
`dlt-source-partition`, `dlt-source-offset`, `dlt-source-timestamp` e
`dlt-failed-at`, além dos headers originais. A DLT é criada com retenção
infinita se ainda não existir.

## Como subir

### Com o ms-catalog (recomendado)

O `docker-compose.yml` do **ms-catalog** sobe os dois serviços e toda a
infraestrutura (Kafka, os dois Postgres, RabbitMQ). Veja o README de lá:

```bash
cd ../ms-catalog && docker compose up -d --build
```

O ms-transport fica em http://localhost:3001.

### No host

Com a infraestrutura do compose do ms-catalog no ar (ou o
`docker-compose.yml` deste repositório para Postgres e RabbitMQ, mais um Kafka):

```bash
cp .env.example .env
corepack yarn@1.22.22 install
npx prisma migrate deploy
npx prisma db seed   # tipos de transporte
corepack yarn@1.22.22 start
```

Use Yarn 1 (`corepack yarn@1.22.22`); o Yarn 4 converte o projeto para PnP.

## Variáveis de ambiente

Validadas com Zod no bootstrap; a aplicação não sobe com env inválida.

| Variável | Padrão | Descrição |
|---|---|---|
| `DATABASE_URL` | obrigatória | URL `postgresql://` |
| `KAFKA_BROKER` | obrigatória | lista `host:porta`; `localhost:9092` no host, `kafka:29092` em container |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | URL `amqp://` |
| `NODE_ENV` | `development` | `production` desliga o pino-pretty |
| `PORT` | `3001` | porta HTTP (8080 na imagem Docker) |
| `LOG_LEVEL` | `info` | nível do Pino |
| `KAFKA_CLIENT_ID` | `ms-transport` | client id do KafkaJS |
| `CONSUMER_RETRY_RETRIES` | `5` | tentativas por mensagem antes do crash e restart |
| `CONSUMER_RETRY_INITIAL_MS` / `CONSUMER_RETRY_MAX_MS` | `300` / `30000` | backoff exponencial |
| `THROTTLE_DEFAULT_TTL_MS` / `THROTTLE_DEFAULT_LIMIT` | `60000` / `100` | rate limit HTTP |
| `HEALTH_CHECK_TIMEOUT_MS` | `1500` | timeout de cada checagem do readiness |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | teto do graceful shutdown |

## API HTTP

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/catalog-items/:itemId` | item do read model (400 se não for UUID, 404 se não existir) |
| `GET` | `/health/live` | liveness |
| `GET` | `/health/ready` | readiness: banco, broker Kafka, consumer (down enquanto degradado) e RabbitMQ |

## Tópicos

| Tópico | Papel |
|---|---|
| `catalog.ItemCreated` | consumido (publicado pelo ms-catalog) |
| `catalog.ItemCreated.DLT` | publicado: mensagens não recuperáveis |

### Inspecionar a DLT

Pela Kafka UI (http://localhost:8090) ou:

```bash
docker exec catalog-kafka kafka-console-consumer --bootstrap-server localhost:29092 \
  --topic catalog.ItemCreated.DLT --from-beginning --property print.headers=true
```

### Reconstruir o read model

Os offsets do grupo ficam no Kafka, não no banco. Para reconstruir o read model
(por exemplo depois de recriar o banco), pare o ms-transport e volte o grupo ao
início:

```bash
docker exec catalog-kafka kafka-consumer-groups --bootstrap-server localhost:29092 \
  --group ms-transport.catalog-items --topic catalog.ItemCreated \
  --reset-offsets --to-earliest --execute
```

## Testes

```bash
corepack yarn@1.22.22 test              # unitários
corepack yarn@1.22.22 test:integration  # Postgres e Kafka reais (testcontainers)
```

A suíte de integração publica a massa do tópico (2 eventos legados, 1 mensagem
inválida, BOX-001 em v1) e verifica o replay (1 item, 3 mensagens na DLT),
reenvio sem duplicar, proteção contra reordenação e poison message para a DLT.
O teste ponta a ponta (catálogo -> read model) fica no ms-catalog
(`yarn test:e2e`).

## Limitações conhecidas

- **Eventos legados sem peso e dimensões** (anteriores ao `schemaVersion: 1`)
  não têm dado para um upcaster reconstruir: vão para a DLT com
  `unsupported_schema_version`.
- **Replay republica na DLT** as mensagens não recuperáveis que já estavam lá:
  a DLT acumula cópias de uma mesma mensagem.
- **Recriar só o banco não reconstrói o read model**: os offsets do grupo
  continuam no Kafka (veja "Reconstruir o read model").
- **Erro não classificado é tratado como recuperável**: nunca perde evento, mas
  um erro permanente trava a partição até intervenção (consumer degradado no
  readiness e crash logado em error).
- **Invariantes duplicadas**: as regras de peso e dimensões são uma cópia das
  do ms-catalog; mudanças lá precisam ser replicadas aqui.
