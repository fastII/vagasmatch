# Agente de contato: a inteligência que fala com quem abriu a vaga

Objetivo do módulo: encurtar o caminho entre "passei no filtro" e "conversei com a pessoa da vaga" de semanas para o mesmo dia, sem transformar o candidato em spam nem colocar a conta dele em risco.

## 1. Três modos, do mais seguro ao mais autônomo

| Modo | O que o agente faz | O que o candidato faz | Quando usar |
|---|---|---|---|
| **Assistido** (padrão; é o que o protótipo entrega) | Escreve a mensagem por canal, com evidências do currículo e o pedido de 15 minutos; prepara o follow-up | Lê, edita, envia com um clique | Sempre; LinkedIn só neste modo |
| **Aprovação por mensagem** | Envia por e-mail ou formulário do ATS depois de um "ok" do candidato; lê a resposta; responde perguntas de triagem que a ficha de fatos cobre; propõe horários | Aprova cada mensagem (push/WhatsApp/e-mail com "aprovar/editar") | E-mail e ATS com API de aplicação |
| **Autônomo com regras** | Follow-up em 5 dias úteis sem resposta (máximo 2), confirmação de horário, resposta a perguntas da ficha de fatos | Define a ficha de fatos e as regras; recebe o resumo | Só para o que não exige decisão nova |

O agente nunca inventa, nunca negocia salário fora da faixa da ficha, nunca aceita ou recusa proposta, nunca envia para mais de N contatos por dia (N configurável, padrão 10) e para na hora que o recrutador pede.

## 2. Canais

| Canal | Como o agente alcança | Regras |
|---|---|---|
| E-mail | Endereço publicado na vaga ou na página de carreiras; caixa transacional com inbound parse para ler respostas | Assunto com o nome da vaga; identificação clara; link de "não quero mais receber" no follow-up |
| Formulário do ATS | Greenhouse (Job Board API aceita aplicação via POST), Lever (postings apply), Ashby; Gupy/Workday pelo navegador do candidato | Envia o currículo ajustado para a vaga e as respostas das perguntas eliminatórias a partir da ficha de fatos; qualquer pergunta fora da ficha escala |
| LinkedIn | Abre a página da pessoa com a mensagem já copiada; a extensão pode preencher o campo sob clique | O envio é sempre do candidato. Nada de automação de InMail/conexões em lote: viola os termos e derruba a conta |
| WhatsApp/telefone | Só quando o recrutador publicou o número | Mensagem curta, sem áudio, sem insistência |

## 3. Como o agente escolhe quem contatar

1. Nome e cargo no corpo da vaga ("vaga aberta por", "fale com", assinatura).
2. Recrutador identificado no board (LinkedIn mostra "Pessoa que publicou"; Greenhouse/Lever às vezes trazem o hiring manager).
3. Página de carreiras / e-mail de talentos publicado.
4. Se nada é público, o agente não "descobre" contato: oferece aplicar pelo formulário e sugerir uma conexão com mensagem no LinkedIn.

## 4. Anatomia da mensagem

A mensagem que funciona com recrutador de tecnologia tem quatro partes e cabe no canal:

1. **Gancho específico**: nome da vaga e um detalhe real (stack, desafio citado na descrição).
2. **Encaixe em evidência**: 2 ou 3 fatos do currículo que batem com requisitos obrigatórios, com número quando existe ("migrei 30 workloads de EKS para OKE").
3. **Gap tratado em uma frase**, só se for eliminatório ou óbvio: "não trabalhei com Istio no dia a dia; tenho base em service mesh com X".
4. **Pedido único e fácil de atender**: 15 minutos esta semana, com dois horários.

Limites: nota de conexão 300 caracteres; mensagem LinkedIn 900; e-mail até 180 palavras. Sem "apaixonado por tecnologia", sem elogio à empresa, sem lista de 12 skills, sem anexos no primeiro contato além do currículo quando o canal é e-mail.

## 5. Conversa com o recrutador (modos 2 e 3)

Classificação de cada resposta recebida:

| Classe | Exemplo | Ação do agente |
|---|---|---|
| Pergunta de triagem coberta pela ficha | "Qual sua pretensão?", "Aceita PJ?", "Mora em SP?" | Responde com o fato da ficha, no tom da conversa, e registra |
| Pergunta fora da ficha | "Topa viajar 50% do tempo?", "Pode começar segunda?" | Escala: manda a pergunta ao candidato com resposta sugerida; só responde após aprovação |
| Convite para conversa | "Tem disponibilidade amanhã?" | Propõe 2 horários da agenda do candidato (integração de calendário) e confirma |
| Pedido de documento/teste | "Envie portfólio", "faça o teste técnico" | Escala com prazo; registra no pipeline |
| Recusa | "Seguimos com outros perfis" | Agradece em uma linha, encerra, marca o estado, pede feedback opcional uma única vez |
| Fora de contexto / outro recrutador | Vaga diferente, empresa diferente | Cria nova oportunidade no pipeline e volta ao fluxo de match |

Transparência: quando o agente responde de forma autônoma, assina como assistente ("Respondo pelo Anderson com base no perfil dele; para o resto ele responde direto"). Em modo assistido, a mensagem é do candidato e não precisa de aviso.

## 6. Guardrails

- Rate limit por candidato e por empresa (uma mensagem por contato por vaga; follow-up no máximo 2).
- Lista de "não contatar" (recrutador pediu, empresa atual do candidato, concorrentes que ele marcou).
- Nunca enviar sem o currículo ajustado estar aprovado quando a mensagem cita ajustes.
- Qualquer menção a salário, data de início, exclusividade ou proposta vai para o candidato.
- Logs de conversa visíveis para o candidato; ele pode assumir a conversa a qualquer momento.
- Refusal da IA ou saída fora do esquema: não envia, escala.

## 7. Prompts (resumo do que o protótipo já usa)

System prompt fixo (cacheado): papel de tech recruiter sênior; nunca inventar; PT-BR direto; critérios eliminatórios primeiro; mensagens curtas por canal; trechos de currículo prontos para colar. As saídas são estruturadas (JSON validado) para o sistema poder agir sobre elas: `score_ia`, `gaps[gravidade]`, `ajustes_curriculo[]`, `perguntas_triagem[]`, `mensagem`, `follow_up`.

Para os modos 2 e 3 entra um segundo prompt com a ficha de fatos e a conversa até aqui, e uma ferramenta `escalar(pergunta, resposta_sugerida)` que o modelo deve chamar quando não tem o fato. Nada de "responda de qualquer jeito".

## 8. O que medir neste módulo

- Tempo da validação ao primeiro contato (meta: mesmo dia).
- Taxa de resposta por canal e por tipo de mensagem (teste A/B do gancho).
- Percentual de perguntas de triagem respondidas pela ficha sem escalar.
- Tempo do contato à primeira conversa marcada.
- Reclamações/opt-outs (meta: zero).
