# Arquitetura do sistema

O protótipo é uma página + um servidor. Este documento descreve o sistema completo que a regra de negócio (agilidade) pede, dividido em módulos que podem entrar um por versão.

## 1. Visão

```
 fontes de vagas ──► Coletor ──► Normalizador ──► Vagas
                                                   │
 currículo/LinkedIn ──► Perfil (parser + skills) ──┤
                                                   ▼
                                               Matcher (regra + IA) ──► Resultado explicável
                                                   │
                                                   ▼
                                     Agente de contato (aprovação humana) ──► Canais
                                                   │
                                                   ▼
                                     Pipeline/CRM do candidato + métricas de agilidade
```

## 2. Módulos

### 2.1 Coletor de vagas

Objetivo: o candidato não copia e cola para sempre; o sistema traz as vagas para ele.

| Fonte | Como | Limite |
|---|---|---|
| Greenhouse, Lever, Ashby, Workable, SmartRecruiters | Job Board APIs públicas, por empresa (`boards-api.greenhouse.io/v1/boards/<empresa>/jobs`, `api.lever.co/v0/postings/<empresa>`, `api.ashbyhq.com/posting-api/job-board/<empresa>`) | Precisa da lista de empresas-alvo; não há busca global |
| Gupy | Portais públicos por empresa (`<empresa>.gupy.io`) com JSON de vagas | Rate limit e layout mudam; respeitar robots e termos |
| Agregadores com API | Adzuna, Jooble, Jobicy, RemoteOK, Remotive (remoto), Trampos e similares | Cobertura parcial no Brasil; licença por chave |
| Sites de empresas | Feed RSS/JSON quando existe; senão, extensão | Cada site é um caso |
| LinkedIn | **Sem API pública de vagas e scraping é proibido pelos termos.** Caminhos legítimos: (a) o candidato cola o texto ou o link; (b) extensão de navegador que lê a página que o candidato está vendo, com a sessão dele, sob clique; (c) parser dos e-mails de alerta de vagas do LinkedIn, que o candidato encaminha para uma caixa do sistema | Nada de coleta em massa |

Cada vaga é normalizada para um esquema único: título, empresa, local, modelo, contrato, texto bruto, seções (required/desired/resp/other), skills extraídas, anos, senioridade, inglês, formação, certificações, nome e canal de quem publicou quando aparecem, URL de aplicação, hash para dedupe entre fontes.

### 2.2 Perfil do candidato

- Parser de PDF/DOCX (texto e, quando o PDF é imagem, OCR) e importação do export do LinkedIn (ZIP "Get a copy of your data").
- Mesmo motor de skills da vaga, para os dois lados falarem o mesmo vocabulário.
- **Ficha de fatos** (fact sheet): o que o agente pode responder sem perguntar ao candidato: pretensão (faixa), modalidade aceita (CLT/PJ), cidade, disponibilidade para híbrido/presencial, data de início, inglês, visto, cargos que não quer. Tudo editável; sem fato, o agente escala.
- Versões do currículo por vaga (o "trecho sugerido" aplicado vira uma versão rastreável).

### 2.3 Matcher

- Camada 1, determinística (o motor do protótipo): milissegundos, explicável, roda no cliente ou no worker.
- Camada 2, IA (Claude, saída estruturada): evidências, gaps com gravidade, trechos de currículo, perguntas de triagem. Roda sob demanda ou em lote (Batches API, 50% do custo) para o feed diário.
- Resultado guarda os dois scores e a explicação; o candidato pode marcar "discordo" e isso vira dado de calibração.
- Alertas: vaga nova com score ≥ 80 e sem knockout gera notificação no mesmo dia (regra de agilidade).

### 2.4 Agente de contato

Detalhado em [03-agente-contato.md](03-agente-contato.md). Resumo: gera a mensagem por canal, o candidato aprova (ou pré-aprova por regra), o sistema envia pelos canais permitidos, lê respostas, responde perguntas de triagem a partir da ficha de fatos, agenda a conversa e escala o resto.

### 2.5 Pipeline e métricas

Estados: validada → contato enviado → respondeu → entrevista → proposta → encerrada. Cada transição com timestamp. Métricas de agilidade em [04-roadmap-metricas.md](04-roadmap-metricas.md). Follow-up automático sugerido em 5 dias úteis sem resposta, máximo 2 por vaga.

## 3. Dados

```
candidato(id, nome, email, telefone, cidade, consentimento_em, retencao_ate)
curriculo(id, candidato_id, versao, texto, origem, criado_em)
ficha_fatos(candidato_id, pretensao_min, pretensao_max, modalidades[], disponibilidade, inicio_em, ingles, visto, nao_quero[])
vaga(id, fonte, url, hash, titulo, empresa, local, modelo, contrato, texto, secoes_json, sinais_json, publicado_em, coletado_em)
contato_vaga(vaga_id, nome, cargo, canal, endereco, origem)        -- quem abriu a vaga, só se público
match(id, candidato_id, vaga_id, curriculo_id, score_regra, score_ia, explicacao_json, criado_em)
candidatura(id, match_id, status, eventos_json, mensagem, canal, enviado_em)
conversa(id, candidatura_id, direcao, canal, texto, autor(agente|candidato|recrutador), em, escalado bool)
```

## 4. LGPD e termos de uso

- Currículo e ficha de fatos são dados pessoais do candidato; base legal é o consentimento, com finalidade explícita (match e contato), retenção definida (ex.: 12 meses após a última atividade) e exclusão a pedido.
- Dados de quem abriu a vaga (nome, e-mail público) só entram se estiverem **publicados** na vaga ou na página da empresa; nunca por enriquecimento de bases de terceiros sem base legal.
- Mensagens do agente sempre identificam que o candidato usa um assistente quando o agente conversa de forma autônoma (ver 03).
- Sem scraping do LinkedIn, sem automação dentro do LinkedIn em massa: o risco é o candidato perder a conta.
- Logs sem conteúdo de currículo; segredos em vault; chave da Anthropic no servidor.

## 5. Stack sugerida

| Camada | Escolha | Motivo |
|---|---|---|
| Frontend | A página do protótipo evolui para Next.js ou fica vanilla com build mínimo | O motor já roda no cliente |
| API | Node 22+ (o servidor do protótipo) ou FastAPI | O motor é JS; Node evita reescrever |
| Workers | Fila (Redis + BullMQ) para coleta, matching em lote e envio/follow-up | Coleta e IA não podem travar a UI |
| Banco | PostgreSQL (jsonb para seções/sinais; pgvector opcional para busca semântica de vagas) | Um banco só |
| IA | Claude `claude-opus-5-5` ou GPT `gpt-5` pelo mesmo contrato de saída estruturada; prompt caching no system; lote (Batches) para o feed | Qualidade com custo controlado e sem prender o produto a um fornecedor |
| Extensão | WebExtension (Chrome/Firefox) que envia o DOM da vaga aberta para `/api/ingest` sob clique | Caminho legítimo para LinkedIn e sites sem API |
| E-mail | Caixa transacional (Resend/SES) com inbound parse para respostas | Canal mais permissivo para automação |
| Deploy | Containers no Cluster Kubernetes |
| Observabilidade | OpenTelemetry | Medir as métricas de agilidade de ponta a ponta |

## 6. Fluxo de uma vaga, ponta a ponta

1. Coletor traz a vaga (ou o candidato cola / extensão envia). Normalizador extrai seções e sinais, dedupe por hash.
2. Matcher camada 1 roda para todos os candidatos com perfil compatível (filtro por cargo/área). Score ≥ 80 sem knockout dispara camada 2 e notificação.
3. Candidato abre o resultado: vê corte, ranking, trechos sugeridos; aplica o ajuste em uma versão do currículo.
4. Agente gera a mensagem por canal. Candidato aprova. Sistema envia (e-mail ou formulário do ATS) ou abre o LinkedIn com a mensagem pronta (clique do candidato).
5. Resposta chega (inbound e-mail / extensão): agente classifica (pergunta de triagem, convite, recusa, pedido de documento), responde o que a ficha de fatos cobre, escala o resto, propõe horários.
6. Pipeline atualiza estado e timestamps; follow-up em 5 dias úteis se silêncio; relatório semanal de agilidade.
