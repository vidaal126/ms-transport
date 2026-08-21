# ms-transport

Microsserviço de transporte, construído com NestJS e Prisma.

## O que este serviço faz

Ainda em construção. Por enquanto o projeto conta com:

- Estrutura base do NestJS (arquitetura em camadas: domain, application,
  infrastructure, presentation) com path aliases configurados.
- Configuração do Prisma 7 com driver adapter (`@prisma/adapter-pg`) para
  PostgreSQL.
- Entidade de domínio `TransportType` e o model Prisma correspondente, já
  com a migration inicial aplicada.
- Logger estruturado (Pino) reaproveitado do `ms-catalog`.

Ainda não há `main.ts`/`app.module.ts`, use cases, controllers ou
repositórios concretos — essas peças serão construídas de forma
incremental.

## Stack

- NestJS + TypeScript
- Prisma 7 (PostgreSQL, via `@prisma/adapter-pg`)
- Pino para logs estruturados

## Rodando localmente

```bash
docker compose up -d
yarn install
yarn start:dev
```

As variáveis de ambiente necessárias estão descritas em `.env` (não versionado).

> `yarn start:dev` ainda não funciona: o bootstrap da aplicação
> (`main.ts`/`app.module.ts`) ainda não foi implementado.

## Integração entre microsserviços

Este é o **segundo microsserviço** do projeto, ao lado do `ms-catalog`.
Ainda não há integração entre eles. Quando este serviço passar a expor
endpoints (HTTP) ou consumir/publicar eventos (RabbitMQ), a forma de
integração deve ser documentada aqui.
