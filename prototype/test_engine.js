// Testes do motor determinístico. Rode: npm test
import './taxonomy.js';
import './engine.js';
import assert from 'node:assert/strict';

const E = globalThis.VagaMatchEngine;

const CV = `Anderson Silva
DevOps Engineer Sênior | São Paulo | anderson@example.com | (11) 99999-1234 | linkedin.com/in/anderson

Resumo
Engenheiro DevOps com mais de 8 anos de experiência em cloud (AWS e OCI), Kubernetes, Terraform e GitOps.
Inglês avançado.

Experiência
Cactus Gaming — DevOps Engineer Sênior — mar/2023 - atual
- Migração de 30 workloads de EKS para OKE (Oracle Cloud) com ArgoCD e Kustomize
- Observabilidade com Datadog e Prometheus/Grafana; redução de 40% no MTTR
- Pipelines CI/CD no GitHub Actions; IaC com Terraform e OpenTofu

Empresa X — SRE Pleno — jan/2019 - fev/2023
- Operação de clusters k8s em AWS (EKS), Helm, Docker
- Automação com Python e Bash; Ansible para configuração
- Kafka (MSK) e PostgreSQL em produção; on-call e post-mortems

Formação
Bacharelado em Sistemas de Informação — 2012 - 2016

Certificações
AWS Certified Solutions Architect Associate; CKA
`;

const JOB = `SRE Sênior (remoto)
Empresa: Fintech Y

Responsabilidades
- Operar e evoluir clusters Kubernetes (EKS) em produção
- Manter pipelines de CI/CD e GitOps com ArgoCD

Requisitos obrigatórios
- 5+ anos de experiência com infraestrutura em nuvem (AWS)
- Kubernetes, Terraform, Docker
- Observabilidade (Prometheus, Grafana)
- Inglês avançado
- Ensino superior completo

Diferenciais
- GCP
- Istio ou outro service mesh
- Certificação CKA

Benefícios
- Plano de saúde, PJ ou CLT
`;

// Caso 1: encaixe forte
const r = E.analyze(CV, JOB, { recrutador: 'Maria Souza', empresa: 'Fintech Y' });
console.log(`caso 1: score=${r.score} band=${r.band} knockouts=${r.knockouts.length}`);
console.log('  obrigatórios:', r.skills.required.map((s) => `${s.name}:${s.ok ? 'ok' : 'X'}`).join(' '));
console.log('  diferenciais:', r.skills.desired.map((s) => `${s.name}:${s.ok ? 'ok' : 'X'}`).join(' '));
console.log('  sinais:', JSON.stringify({ anos: r.sinais.cvYears, exige: r.sinais.jobYears, sen: [r.sinais.cvSeniority, r.sinais.jobSeniority], ing: [r.sinais.cvEnglish, r.sinais.jobEnglish] }));
assert.ok(r.score >= 80, `score esperado >= 80, veio ${r.score}`);
assert.equal(r.knockouts.length, 0, 'não deveria ter knockout: ' + JSON.stringify(r.knockouts));
const req = Object.fromEntries(r.skills.required.map((s) => [s.name, s.ok]));
for (const k of ['Kubernetes', 'Terraform', 'Docker', 'Prometheus', 'Grafana', 'AWS', 'ArgoCD']) assert.equal(req[k], true, `${k} deveria ser obrigatório e ok`);
const des = Object.fromEntries(r.skills.desired.map((s) => [s.name, s.ok]));
assert.equal(des['GCP'], false, 'GCP é diferencial ausente');
assert.equal(des['Istio'], false, 'Istio é diferencial ausente');
assert.ok(r.sinais.cvYears >= 6 && r.sinais.cvYears <= 9, `anos do CV fora do esperado: ${r.sinais.cvYears} (formação não deve contar)`);
assert.equal(r.sinais.jobYears, 5);
assert.equal(r.sinais.jobEnglish, 'avançado');
assert.equal(r.sinais.cvEnglish, 'avançado');
assert.equal(r.sinais.jobSeniority, 'sênior');
assert.equal(r.sinais.cvSeniority, 'sênior');
assert.ok(r.skills.certsMissing.length === 0, 'CKA está no CV; não pode faltar');
assert.ok(r.mensagem.includes('Olá, Maria!'), 'mensagem deve saudar o recrutador');
assert.ok(E.buildMessage(r, 'linkedin_nota', E.normalize(CV)).length <= 300, 'nota do LinkedIn <= 300 chars');

// Caso 2: knockouts (anos e inglês)
const CV2 = `Joana Lima
Analista de Infraestrutura Júnior | joana@example.com | (21) 98888-0000
Experiência
Empresa Z — Analista Júnior — jan/2025 - atual
- Suporte a servidores Linux, scripts em Bash, Docker em ambiente de testes
Formação
Tecnólogo em Redes — 2020 - 2022
`;
const r2 = E.analyze(CV2, JOB);
console.log(`caso 2: score=${r2.score} band=${r2.band} knockouts=${r2.knockouts.length}`);
for (const k of r2.knockouts) console.log('  -', k);
assert.ok(r2.knockouts.some((k) => /Anos de experi/.test(k)), 'deveria reprovar por anos');
assert.ok(r2.knockouts.some((k) => /Ingl/.test(k)), 'deveria reprovar por inglês');
assert.ok(r2.score <= 59, 'com knockout o score fica <= 59');
assert.ok(r2.sugestoes.some((s) => s.tipo === 'gap'), 'deve sugerir os gaps');

// Caso 3: vaga sem seções (tudo obrigatório) e termo diferente (k8s vs Kubernetes)
const JOB3 = `Procuramos DevOps pleno com Kubernetes, Terraform e GitHub Actions. Datadog é um diferencial. Inglês intermediário.`;
const CV3 = `Carlos
carlos@example.com
Experiência
Empresa W — DevOps Pleno — 2020 - atual: clusters k8s, terraform, github actions, datadog. Inglês intermediário.
`;
const r3 = E.analyze(CV3, JOB3);
console.log(`caso 3: score=${r3.score} semSecoes=${r3.sinais.semSecoes}`);
assert.equal(r3.sinais.semSecoes, true);
assert.ok(r3.skills.desired.some((s) => s.name === 'Datadog' && s.ok), 'Datadog deve ser diferencial ok (frase "é um diferencial")');
assert.ok(r3.sugestoes.some((s) => s.tipo === 'termo' && /kubernetes/i.test(s.msg)), 'deve sugerir usar o termo literal "kubernetes"');
assert.equal(r3.knockouts.length, 0);

// Caso 4: internos
const I = E._internals;
assert.equal(I.yearsFromRanges('jan/2020 - dez/2021\n2022 - atual').intervalos, 2);
assert.equal(I.explicitYears('empresa com 20 anos de mercado. buscamos 3+ anos de experiencia', true), 3);
assert.equal(I.english('ingles fluente').nivel, 4);
assert.equal(I.seniority('engenheiro de software senior', true).label, 'sênior');
assert.ok(!I.findAll('javascript e java', I.SKILLS).some((s) => s.name === 'Java' && s.hits > 1), 'java não casa dentro de javascript');
assert.ok(I.findAll('experiencia com go, python', I.SKILLS).some((s) => s.name === 'Go'), '"go" em lista conta');
assert.ok(!I.findAll('we go to market fast', I.SKILLS).some((s) => s.name === 'Go'), '"go" em frase não conta');

console.log('OK: todos os testes passaram');
