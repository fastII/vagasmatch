# Roadmap e métricas de agilidade

A regra de negócio é uma só: o processo tem que ser ágil, não moroso. Cada versão abaixo só entra se mover uma das métricas da seção 2.

## 1. Versões

### MVP (o protótipo desta pasta)

- Validação ATS determinística no navegador, em segundos, explicável.
- Ajustes de currículo (gaps, termos literais, formato) e, com IA, trechos prontos, perguntas de triagem com resposta e score do recrutador.
- Mensagem por canal + follow-up; pipeline local com estados, timestamps e KPIs.
- Sem backend de dados: tudo no navegador; IA via servidor local.

Critério de pronto: 10 candidatos reais validam 3 vagas cada, enviam a mensagem e registram o retorno. Comparar tempo até o retorno com o histórico deles.

### v1 (4 a 6 semanas)

- Conta do candidato, perfil persistido, parser de PDF/DOCX e import do LinkedIn.
- Ficha de fatos.
- Coletor: Greenhouse/Lever/Ashby por lista de empresas + um agregador com API; extensão de navegador para LinkedIn/Gupy/sites (envio da página aberta sob clique).
- Matching em lote (Batches) com notificação no mesmo dia para score ≥ 80 sem knockout.
- Envio por e-mail com aprovação e leitura de respostas (inbound).
- Pipeline no servidor, follow-up sugerido automaticamente.

### v2 (depois de medir a v1)

- Aplicação direta via API dos ATS que aceitam (Greenhouse, Lever, Ashby), com respostas eliminatórias da ficha.
- Agente de conversa (modos 2 e 3), integração de calendário, escalonamento.
- Calibração do score com o resultado real (quem respondeu, quem chamou para entrevista).
- Versão B2B: o mesmo motor do lado do recrutador, para triagem explicável e feedback automático ao candidato (o lado mais moroso do mercado hoje).

## 2. Métricas (o que define "ágil")

| Métrica | Como medir | Meta |
|---|---|---|
| Tempo para validar uma vaga | do colar ao score | < 60 s |
| Tempo da validação ao primeiro contato | timestamp validada → contato_enviado | mesmo dia (≤ 24 h) |
| Taxa de resposta ao primeiro contato | respondeu / contato_enviado | > 30% (benchmark de mensagem fria bem feita: 15 a 30%) |
| Tempo até o retorno | contato_enviado → respondeu | mediana ≤ 5 dias úteis |
| Tempo até a primeira conversa | contato_enviado → entrevista | mediana ≤ 10 dias úteis |
| Candidaturas evitadas por knockout | vagas validadas com eliminatório e não aplicadas | reportar (economia de tempo do candidato) |
| Follow-ups pendentes | contatos sem resposta há 5+ dias e sem follow-up | 0 ao fim do dia |
| Precisão do filtro | score ≥ 65 sem knockout **e** avançou / total com score ≥ 65 | calibrar; > 50% na v1 |
| Falsos cortes | score < 50 ou knockout **e** avançou mesmo assim | investigar cada caso |
| Opt-outs e reclamações | por 100 mensagens | 0 |

## 3. Riscos e respostas

| Risco | Resposta |
|---|---|
| LinkedIn bloquear a conta por automação | Nunca automatizar dentro do LinkedIn; extensão só lê a página aberta e preenche sob clique |
| Mensagens genéricas virarem spam | Evidência obrigatória do currículo na mensagem; limite diário; opt-out |
| Score "errado" gerar frustração | Explicação por componente, dois scores (regra e IA), botão "discordo" alimentando calibração |
| Custo de IA no feed diário | Camada 1 filtra; camada 2 só para score ≥ 80; Batches; prompt caching |
| LGPD | Consentimento, retenção, exclusão, dados de recrutador só públicos |
