# Modelo de filtros ATS

Como um tech recruiter de verdade tria, e como o VagaMatch reproduz isso para o candidato ver o resultado antes de aplicar.

## 1. O que acontece com um currículo dentro do ATS

| Etapa | O que o sistema faz | Onde o candidato morre |
|---|---|---|
| Parse | Extrai texto e tenta reconhecer seções: contato, experiência (empresa, cargo, datas), formação, habilidades | PDF em colunas, tabelas, ícones no lugar de "E-mail", cabeçalho com dados de contato (muitos parsers ignoram header/footer) |
| Perguntas eliminatórias | Formulário de aplicação com knockout: pretensão salarial, cidade/disponibilidade, modalidade (CLT/PJ), inglês, anos de experiência, visto/documentação | Responder "não" em qualquer uma = descartado sem leitura |
| Requisitos obrigatórios | Busca literal (às vezes booleana) pelos termos da vaga: "Kubernetes", "Terraform", "5 anos" | Sinônimo ("k8s"), termo só no título, termo sem contexto |
| Ranking | Ordena por quantidade e recência das palavras-chave; alguns boards mostram "aderência" ao recrutador | Palavra-chave aparece uma vez, em experiência antiga |
| Leitura humana | Recrutador lê os 20 a 30 primeiros do ranking, 6 a 8 segundos cada: título, empresa atual, tempo de casa, stack | Título genérico, resultado sem número, gaps sem explicação |
| Triagem (screening) | Ligação ou mensagem de 10 minutos: confirma knockouts, pretensão, motivação, disponibilidade | Resposta vaga ou incoerente com o currículo |

Cada ATS tem sua implementação, mas o padrão é o mesmo: **eliminatório primeiro, palavra-chave literal depois, humano por último**. O VagaMatch modela essas três camadas.

## 2. O modelo do VagaMatch

### 2.1 Entradas

- Currículo em texto (do PDF, do LinkedIn ou digitado).
- Descrição da vaga em texto, com as seções que o board publicou.
- Opcional: empresa, nome de quem abriu a vaga, canal de contato.

### 2.2 Leitura da vaga

A vaga é dividida por cabeçalhos em quatro baldes:

| Balde | Cabeçalhos reconhecidos (PT/EN) | Uso |
|---|---|---|
| required | requisitos, obrigatórios, necessário, imprescindível, requirements, must have, o que buscamos, qualificações | tecnologias e critérios eliminatórios |
| desired | diferenciais, desejável, nice to have, plus, bonus, valorizamos, preferred | ranking, não elimina |
| resp | responsabilidades, atividades, o que você vai fazer, you will, desafios | conta como obrigatório (é o que o cargo faz) |
| other | benefícios, sobre a empresa, processo seletivo, remuneração | ignorado |

Linhas com "é um diferencial" ou "desejável" vão para desired mesmo dentro de requisitos; linhas com "obrigatório" ou "must have" vão para required. Vaga sem cabeçalhos: tudo vira obrigatório e o candidato é avisado.

### 2.3 Extração de skills

Taxonomia de ~190 skills de tecnologia com sinônimos (`prototype/taxonomy.js`): linguagens, frontend, backend, mobile, cloud, IaC, containers, CI/CD, observabilidade/SRE, dados, bancos, mensageria, segurança, redes, métodos, QA, IA, ferramentas, comportamentais. Mais 19 certificações.

Regras de casamento:
- Fronteira de palavra que entende `c++`, `c#`, `.net`, `node.js`; "java" não casa dentro de "javascript".
- Termos ambíguos ("go", "spring", "express") só casam em contexto de lista ou com alias inequívoco ("golang").
- Cada lado guarda **o termo literal** que usou. Se a vaga diz "Kubernetes" e o currículo só diz "k8s", o skill conta como presente, mas sai a sugestão "use o termo da vaga": busca por palavra-chave é literal.

### 2.4 Sinais estruturados

| Sinal | Na vaga | No currículo |
|---|---|---|
| Anos de experiência | "5+ anos", "at least 3 years", só quando perto de "experiência" (ignora "empresa com 20 anos de mercado") | União dos intervalos de datas da seção Experiência (mês quando houver; formação não conta) **ou** declaração explícita ("mais de 8 anos"), o maior dos dois |
| Senioridade | Título primeiro (estágio, júnior, pleno, sênior, especialista/lead) | Maior nível declarado |
| Inglês | Nível pedido (básico, intermediário, avançado, fluente); "inglês" sem nível = intermediário | Nível declarado; sem menção = não tem |
| Formação | "superior completo", "graduação em", "bacharel", "degree" | bacharel, tecnólogo, engenharia, pós, MBA, mestrado; "cursando" vale meio ponto |
| Local e modelo | remoto, híbrido, presencial + cidade | cidade |
| Contrato | CLT, PJ | menções no currículo |
| Certificações | citadas em requisitos | citadas no currículo |
| Formato | | e-mail, telefone, LinkedIn, tamanho (200 a 1500 palavras), seção "Experiência", datas, resumo no topo, bullets |

### 2.5 Score (0 a 100)

| Componente | Peso | Cálculo |
|---|---|---|
| Requisitos obrigatórios | 45 (60 se a vaga não tem diferenciais) | encontrados / listados |
| Diferenciais | 15 | encontrados / listados |
| Anos de experiência | 15 | min(1, anos do candidato / anos pedidos); sem datas no currículo = 0,5 |
| Senioridade | 10 | igual ou acima = 1; um degrau abaixo = 0,6; dois ou mais = 0,2; vaga sem nível = 0,7 |
| Inglês | 5 | nível igual ou acima = 1; um abaixo = 0,5; dois ou mais / não declarado = 0 |
| Formação | 5 | exigida e presente = 1; cursando = 0,6; ausente = 0 |
| Formato para o ATS | 5 | 1 menos 0,3 por flag crítica, 0,12 por atenção, 0,05 por leve |

Faixas: **Forte** ≥ 80, **Bom** 65 a 79, **Limítrofe** 50 a 64, **Fraco** < 50.

### 2.6 Critérios eliminatórios (knockouts)

Reproduzem a aplicação com perguntas eliminatórias. Qualquer um presente **trava o score em 59** e muda o veredito para "provável reprovação automática", porque é isso que acontece no ATS: nota alta em palavra-chave não salva quem respondeu "não" na pergunta de corte.

- Anos de experiência abaixo de 75% do mínimo pedido (com datas detectadas).
- Inglês exigido e currículo sem inglês ou com nível menor.
- Formação superior exigida e ausente.
- Certificação listada em requisitos e ausente.
- Vaga com 3+ requisitos obrigatórios e nenhum encontrado.

Pontos de atenção (não travam, mas viram pergunta eliminatória na aplicação): vaga presencial/híbrida em cidade diferente da do currículo; vaga só PJ com currículo que só fala em CLT; vaga sem seções.

### 2.7 Saída

- Score, faixa, veredito, lista de eliminatórios e pontos de atenção.
- Cada componente com seu peso, valor e a frase que explica ("3 de 5 requisitos obrigatórios encontrados").
- Obrigatórios e diferenciais, cada um com ✓ ou ✕; o que o candidato traz a mais.
- Sugestões acionáveis, por tipo: `gap`, `termo`, `diferencial`, `senioridade`, `idioma`, `formato`.
- Mensagem para quem abriu a vaga, por canal.

## 3. Camada de IA (quando ligada)

O motor determinístico é rápido, explicável e roda no navegador. A IA (Claude `claude-opus-5-5` ou GPT `gpt-5`, saída estruturada em JSON validado) entra onde a regra não chega:

- **Evidência**: pontos fortes citando o trecho do currículo que prova cada um.
- **Gaps com gravidade** (eliminatório, importante, leve) e o que dizer sobre cada um com honestidade.
- **Riscos no ATS** que a regra não vê: experiência relevante escondida em cargo com título genérico, resultado sem número, stack citada só em projeto pessoal.
- **Trechos prontos** para o currículo, no vocabulário literal da vaga, sem inventar fatos (regra fixa do prompt).
- **Perguntas de triagem** que o recrutador tende a fazer para esta vaga, com resposta sugerida a partir do currículo.
- **Mensagem** para quem abriu a vaga, respeitando o limite do canal, mais o follow-up.

O prompt recebe o pré-filtro determinístico como ponto de partida e tem licença para discordar quando o currículo justificar; o candidato vê os dois scores.

## 4. Limites conhecidos do modelo

- Vaga mal escrita (sem seções, requisitos misturados com benefícios) reduz a precisão; o aviso "tratei tudo como obrigatório" existe para isso.
- Anos de experiência dependem de datas legíveis; currículo sem datas recebe 0,5 e a flag crítica.
- A taxonomia cobre tecnologia; cargos fora de TI (produto, design, dados de negócio) precisam de vocabulário próprio.
- O score imita o ATS, não o substitui: cada empresa configura pesos e perguntas diferentes. O valor está em **ver o corte antes de aplicar** e em corrigir o que é corrigível.
