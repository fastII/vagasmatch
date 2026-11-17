# VagaMatch

Sistema que coloca o candidato de tecnologia do lado certo do filtro: valida o perfil contra a vaga **como um ATS faria**, mostra o que corta e o que ranqueia, corrige o currículo com o vocabulário literal da vaga e abre o contato direto com quem publicou a oportunidade. Regra de negócio única: **o processo tem que ser ágil**. Validar uma vaga leva segundos, o primeiro contato sai no mesmo dia e nada fica parado sem follow-up.

## O problema que ele resolve

- Entre 70% e 90% dos currículos nunca chegam a um humano: o ATS (Gupy, Greenhouse, Lever, Workday, LinkedIn Recruiter) corta por critério eliminatório ou por falta de palavra-chave literal.
- O candidato aplica em dezenas de vagas sem saber se passa do filtro, e espera semanas por um "não" automático.
- Quem abriu a vaga é alcançável (LinkedIn, e-mail, formulário do ATS), mas o candidato não sabe o que dizer em 300 caracteres.

## Como funciona (3 passos, menos de 1 minuto)

1. **Validar**: cola currículo + descrição da vaga. O motor determinístico reproduz o filtro do ATS: critérios eliminatórios (anos, inglês, formação, certificação, local), requisitos obrigatórios x diferenciais, senioridade, legibilidade do currículo para o parser. Score 0 a 100 com cada componente explicado. Ver [docs/01-modelo-ats.md](docs/01-modelo-ats.md).
2. **Ajustar**: lista o que falta, o termo literal que a vaga usa e você escreveu diferente ("k8s" x "Kubernetes"), e com IA gera trechos prontos para colar, sem inventar fatos.
3. **Contatar**: gera a mensagem para quem abriu a vaga (nota de conexão, mensagem do LinkedIn ou e-mail), com follow-up pronto, e acompanha o funil no pipeline: tempo até o retorno, taxa de resposta, quem está há 5+ dias sem resposta.

A "inteligência que fala com o recrutador" está desenhada em [docs/03-agente-contato.md](docs/03-agente-contato.md): o candidato aprova cada mensagem (padrão), o agente responde perguntas de triagem a partir de uma ficha de fatos e escala para o humano o que não sabe. O protótipo entrega a parte assistida.

## Rodar o protótipo

```bash
# na raiz do repositório (ou dentro de prototype/, tanto faz)
npm install
cp .env.example .env           # e preencha OPENAI_API_KEY ou ANTHROPIC_API_KEY; sem chave, só a parte determinística funciona
npm start                      # http://localhost:3000
npm test                       # testes do motor (node)
```

- **Onde fica a chave**: copie `.env.example` para `.env` na raiz e preencha `OPENAI_API_KEY` ou `ANTHROPIC_API_KEY`. O `npm start` lê o `.env` sozinho; o arquivo está no `.gitignore`. `export` na linha de comando também funciona, mas vale só para aquele terminal e some ao fechar. A chave nunca chega ao navegador: fica no processo do servidor e só vai para a API do provedor.
- Sem servidor (abrindo `prototype/index.html` direto) o filtro ATS, as sugestões, a mensagem padrão e o pipeline funcionam. Só os botões "com IA" ficam desligados.
- **Provedor de IA**: Claude (Anthropic) ou GPT (OpenAI), mesmo contrato de saída. O servidor escolhe pela chave presente (`ANTHROPIC_API_KEY` tem prioridade, depois `OPENAI_API_KEY`) ou pelo que você forçar com `VAGAMATCH_PROVIDER=anthropic|openai`. Modelos padrão `claude-opus-5-5` e `gpt-5`; troque com `VAGAMATCH_MODEL`. Esforço de raciocínio com `VAGAMATCH_EFFORT` (low, medium, high). O indicador no topo da página mostra provedor e modelo ativos.
- A chave fica apenas no servidor, que não persiste currículo nem vaga e não os escreve em log.
- Clique em **Carregar exemplo** para ver o fluxo completo com um currículo e uma vaga de SRE.

## Rodar com Docker (Postgres + FastAPI + front)

Mesma página, mas com o backend em Python (FastAPI) e o pipeline persistido no Postgres em vez do navegador.

```bash
cp .env.example .env           # OPENAI_API_KEY ou ANTHROPIC_API_KEY (o compose lê o .env sozinho)
docker compose up --build      # http://localhost:3080
docker compose down            # para; `docker compose down -v` apaga também o banco
```

| Serviço | Imagem | Porta | O que faz |
|---|---|---|---|
| `web` | nginx + `prototype/index.html`, `engine.js`, `taxonomy.js` | 3080 | serve a página e repassa `/api/*` para a API |
| `api` | `backend/` (FastAPI + uvicorn) | 3081 | `/api/health`, `/api/analyze`, `/api/outreach` (Claude ou GPT, saída estruturada) e `/api/pipeline`; docs em `/api/docs` |
| `db` | postgres:17 | interna | tabela `candidaturas` (pipeline); volume `pgdata` |

A chave fica só no container da API (vem do `.env` via `env_file`). Com o banco presente, a página carrega e salva o pipeline em `/api/pipeline`, e o localStorage vira cache; sem banco (modo `npm start`) continua tudo no navegador. Portas e credenciais do Postgres mudam pelo `.env` (`WEB_PORT`, `API_PORT`, `POSTGRES_*`).

Para rodar o backend Python sem Docker: `cd backend && pip install -r requirements.txt && uvicorn app.main:app --port 8000` (usa sqlite local se `DATABASE_URL` não estiver definido).

## Estrutura

```
README.md                 este arquivo
package.json              workspace: npm install/start/test funcionam na raiz
.env.example              modelo do .env com a chave do provedor (o .env real não vai para o git)
docs/01-modelo-ats.md     como o ATS filtra e o modelo de score que o VagaMatch reproduz
docs/02-arquitetura.md    sistema completo: fontes de vagas, matching, agente, dados, LGPD, stack
docs/03-agente-contato.md a inteligência que fala com quem abriu a vaga: canais, guardrails, fluxos
docs/04-roadmap-metricas.md MVP, versões seguintes e as métricas de agilidade
prototype/index.html      app (uma página, sem framework)
prototype/engine.js       motor ATS determinístico e explicável (browser + node)
prototype/taxonomy.js     vocabulário técnico com sinônimos (~190 skills, certificações)
prototype/server.js       servidor estático + /api/analyze e /api/outreach (Claude ou GPT, saída estruturada)
prototype/test_engine.js  testes do motor
docker-compose.yml        Postgres + API FastAPI + front nginx
backend/                  API em Python (FastAPI): app/ai.py (IA), app/db.py (pipeline no Postgres), app/main.py (rotas)
web/                      nginx.conf e Dockerfile do front
```

## O que o protótipo não faz (ainda)

- Não busca vagas sozinho. LinkedIn não tem API pública de vagas e proíbe scraping; o caminho é colar o texto, uma extensão de navegador que lê a página que o candidato está vendo, e APIs públicas de boards (Greenhouse, Lever, Ashby, Gupy) para empresas específicas. Detalhes e limites em [docs/02-arquitetura.md](docs/02-arquitetura.md).
- Não envia mensagens. Quem envia é o candidato, com um clique. O envio automático com aprovação e o tratamento de respostas estão no roadmap, com as regras de [docs/03-agente-contato.md](docs/03-agente-contato.md).
- Não lê PDF. Cole o texto (o parser de PDF entra na v1).
