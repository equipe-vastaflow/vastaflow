# ADR 0002 - Formato de modulo do backend: CommonJS

- **Status:** aceito
- **Data:** 2026-09-21
- **Decisores:** equipe VastaFlow

## Contexto

O **NestJS 12 e distribuido como ESM**: todos os pacotes `@nestjs/*` declaram
`"type": "module"` no seu `package.json`. Isso e uma mudanca em relacao as
versoes anteriores, que eram CommonJS.

O gerador oficial (`@nestjs/schematics` 12) oferece **dois templates**:

| Template | `type` no package.json | Test runner | Lint   |
| -------- | ---------------------- | ----------- | ------ |
| `ts`     | ausente (CommonJS)     | Jest        | oxlint |
| `ts-esm` | `module`               | Vitest      | oxlint |

Ambos usam `"module": "nodenext"` no `tsconfig.json`.

O template CommonJS funciona porque o **Node 22+ consegue carregar modulos ESM
a partir de `require()`** (`require(esm)`), desde que o modulo nao use
top-level `await`. O TypeScript so permite essa combinacao com
`module: nodenext` - com `node18` ou `commonjs` o compilador emite `TS1479`.

## Decisao

Usar **CommonJS** (`module: nodenext`, sem `"type": "module"`), com **Jest** e
**ESLint**.

## Motivo

A Etapa 2 introduz **TypeORM com dois drivers**, incluindo Oracle - ja a parte
mais arriscada do projeto. O caminho ESM do TypeORM tem arestas conhecidas
(carregamento de entities por glob, CLI de migrations, resolucao de caminhos).
Empilhar friccao de ESM sobre a friccao de Oracle aumentaria o risco sem
beneficio imediato.

Jest e ESLint tambem sao significativamente mais conhecidos que Vitest e oxlint,
o que importa num time de dois desenvolvedores.

## Consequencias

- `npm test` roda com `node --experimental-vm-modules`, exigido pelo Jest para
  carregar as dependencias ESM do NestJS. E exatamente o que o template oficial
  CommonJS faz - nao e uma giria nossa.
- Imports relativos **nao** precisam da extensao `.js`.
- `tsconfig.json` usa `rootDir: "."` para que o typecheck alcance `test/`;
  `tsconfig.build.json` sobrescreve para `rootDir: "./src"`, de modo que o
  artefato final fique em `dist/main.js`.
- **A decisao e reversivel.** Migrar para ESM depois exige: adicionar
  `"type": "module"`, acrescentar `.js` aos imports relativos e trocar o test
  runner. Nenhuma regra de negocio e afetada.

## Pendencia

`@nestjs/schematics@12.0.4` declara `engines.node: ^22.22.3 || ^24.15.0 || >=26`.
A maquina de desenvolvimento atual roda **Node 24.14.1**, logo abaixo do minimo.
O `npm install` apenas emite `EBADENGINE` e o projeto compila, testa e executa
normalmente, mas **recomenda-se atualizar para Node >= 24.15.0** para evitar
problemas com `nest generate`.
