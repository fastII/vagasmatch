// server.js — serve o protótipo e expõe a camada de IA por trás de /api.
// Provedor: Claude (Anthropic) ou GPT (OpenAI). Escolhido pela chave presente no ambiente
// (ANTHROPIC_API_KEY tem prioridade, depois OPENAI_API_KEY) ou forçado com
// VAGAMATCH_PROVIDER=anthropic|openai. A chave fica só no servidor.
// Nada é persistido: currículo e vaga passam pela requisição e morrem com ela.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { zodTextFormat } from 'openai/helpers/zod';
import './taxonomy.js';
import './engine.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 1_000_000;
const MAX_OUTPUT_TOKENS = 16000;

// ---------------------------------------------------------------- provedor
const DEFAULT_MODEL = { anthropic: 'claude-opus-5-5', openai: 'gpt-5' };
const DEFAULT_EFFORT = { anthropic: 'high', openai: 'medium' };
const looksLikeKey = (v) => !!v && v.length >= 30 && !/your|xxx|placeholder|changeme/i.test(v);
const KEYS = { anthropic: looksLikeKey(process.env.ANTHROPIC_API_KEY), openai: looksLikeKey(process.env.OPENAI_API_KEY) };

function pickProvider() {
  const forced = (process.env.VAGAMATCH_PROVIDER || '').toLowerCase();
  if (forced) {
    if (!DEFAULT_MODEL[forced]) throw new Error(`VAGAMATCH_PROVIDER inválido: "${forced}" (use anthropic ou openai)`);
    return forced;
  }
  if (KEYS.anthropic) return 'anthropic';
  if (KEYS.openai) return 'openai';
  return 'anthropic'; // o SDK da Anthropic ainda pode resolver um perfil do `ant auth login`
}

let PROVIDER = null, MODEL = null, EFFORT = null, client = null, aiError = null;
try {
  PROVIDER = pickProvider();
  MODEL = process.env.VAGAMATCH_MODEL || DEFAULT_MODEL[PROVIDER];
  EFFORT = process.env.VAGAMATCH_EFFORT || DEFAULT_EFFORT[PROVIDER];
  client = PROVIDER === 'openai' ? new OpenAI() : new Anthropic();
} catch (e) {
  aiError = e.message;
}

// ---------------------------------------------------------------- prompt e esquemas
const SYSTEM = `Você é um tech recruiter sênior, especialista em triagem com ATS (Gupy, Greenhouse, Lever, Workday, LinkedIn Recruiter) e em contratação de tecnologia no Brasil.

Regras fixas:
1. Nunca invente experiência, ferramenta, número ou resultado que não esteja no currículo. Se faltar, diga como o candidato deve tratar o gap com honestidade.
2. Responda em português do Brasil, direto, sem clichês ("apaixonado por tecnologia", "mentalidade de dono") e sem bajulação.
3. Pense como o ATS e como o humano que lê em 8 segundos: critérios eliminatórios primeiro, depois ranking por palavras-chave literais da vaga, depois evidência (projeto, ano, resultado).
4. Mensagens para quem abriu a vaga: curtas, específicas, em primeira pessoa (quem envia é o candidato), com um pedido claro (conversa de 15 minutos). Nota de conexão no LinkedIn: no máximo 300 caracteres. Mensagem no LinkedIn: no máximo 900. E-mail: assunto objetivo com o nome da vaga.
5. Toda recomendação de currículo deve ser um trecho pronto para colar, no vocabulário literal da vaga.`;

const AnaliseSchema = z.object({
  score_ia: z.number().describe('0 a 100, chance de passar da triagem para a entrevista'),
  veredito: z.string().describe('Uma frase objetiva'),
  pontos_fortes: z.array(z.string()).describe('Até 6, cada um citando a evidência do currículo'),
  gaps: z.array(z.object({
    requisito: z.string(),
    gravidade: z.enum(['eliminatorio', 'importante', 'leve']),
    como_tratar: z.string().describe('O que dizer ou fazer, com honestidade'),
  })).describe('Até 8'),
  riscos_ats: z.array(z.string()).describe('Até 6 riscos de parser, palavra-chave ou pergunta eliminatória'),
  ajustes_curriculo: z.array(z.object({
    onde: z.string().describe('Seção ou linha do currículo'),
    trecho_sugerido: z.string().describe('Texto pronto para colar, sem inventar fatos'),
    motivo: z.string(),
  })).describe('Até 6'),
  perguntas_triagem: z.array(z.object({
    pergunta: z.string().describe('Pergunta que o recrutador tende a fazer para esta vaga'),
    resposta_sugerida: z.string().describe('Resposta curta, baseada só no currículo'),
  })).describe('Até 6'),
});

const MensagemSchema = z.object({
  assunto: z.string().describe('Só para e-mail; vazio nos outros canais'),
  mensagem: z.string().describe('Texto final, pronto para enviar, respeitando o limite do canal'),
  follow_up: z.string().describe('Mensagem curta de follow-up para 5 dias úteis depois, caso não haja resposta'),
});

const CANAIS = {
  linkedin_nota: 'nota de conexão no LinkedIn (máximo 300 caracteres, sem assunto)',
  linkedin_mensagem: 'mensagem direta no LinkedIn (máximo 900 caracteres, sem assunto)',
  email: 'e-mail (assunto objetivo + corpo de até 180 palavras)',
};

const fail = (msg, status) => Object.assign(new Error(msg), { status: status || 502 });

// ---------------------------------------------------------------- chamadas por provedor
async function callAnthropic(schema, userText) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: EFFORT, format: zodOutputFormat(schema) },
    messages: [{ role: 'user', content: userText }],
  });
  if (response.stop_reason === 'refusal') {
    const why = response.stop_details && response.stop_details.explanation;
    throw fail('O modelo recusou a solicitação' + (why ? ': ' + why : '.'));
  }
  if (response.stop_reason === 'max_tokens') throw fail('Resposta truncada (max_tokens).');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let json;
  try { json = JSON.parse(text); } catch { throw fail('Resposta da IA não veio em JSON válido.'); }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw fail('Resposta da IA fora do esquema esperado.');
  const u = response.usage || {};
  return { data: parsed.data, provider: 'anthropic', model: response.model || MODEL, usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read_input_tokens: u.cache_read_input_tokens || 0 } };
}

const OPENAI_REASONING = /^(gpt-5|o[1-9])/; // modelos que aceitam reasoning.effort
async function callOpenAI(schema, userText) {
  const response = await client.responses.parse({
    model: MODEL,
    instructions: SYSTEM,
    input: userText,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    ...(OPENAI_REASONING.test(MODEL) ? { reasoning: { effort: EFFORT } } : {}),
    text: { format: zodTextFormat(schema, 'resultado') },
  });
  if (response.status === 'incomplete') throw fail(`Resposta truncada (${(response.incomplete_details && response.incomplete_details.reason) || 'incompleta'}).`);
  const refusal = (response.output || []).flatMap((o) => o.content || []).find((c) => c.type === 'refusal');
  if (refusal) throw fail('O modelo recusou a solicitação: ' + refusal.refusal);
  const parsed = schema.safeParse(response.output_parsed);
  if (!parsed.success) throw fail('Resposta da IA fora do esquema esperado.');
  const u = response.usage || {};
  return { data: parsed.data, provider: 'openai', model: response.model || MODEL, usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read_input_tokens: (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0 } };
}

const callModel = (schema, userText) => (PROVIDER === 'openai' ? callOpenAI(schema, userText) : callAnthropic(schema, userText));

function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '\n[...cortado...]' : s; }
const E = () => globalThis.VagaMatchEngine;

async function analyze(body) {
  const cv = clip(body.cv, 20000), job = clip(body.job, 12000);
  if (!cv.trim() || !job.trim()) throw fail('Envie cv e job.', 400);
  const resumo = body.resumo || E().summary(E().analyze(cv, job, body.opts || {}));
  const user = `Avalie este candidato para esta vaga como o ATS e o recrutador fariam. Use o pré-filtro determinístico abaixo como ponto de partida, mas discorde quando o currículo justificar.

<prefiltro_json>
${JSON.stringify(resumo, null, 1)}
</prefiltro_json>

<vaga>
${job}
</vaga>

<curriculo>
${cv}
</curriculo>`;
  return callModel(AnaliseSchema, user);
}

async function outreach(body) {
  const cv = clip(body.cv, 20000), job = clip(body.job, 12000);
  if (!cv.trim() || !job.trim()) throw fail('Envie cv e job.', 400);
  const canal = CANAIS[body.canal] ? body.canal : 'linkedin_mensagem';
  const resumo = body.resumo || E().summary(E().analyze(cv, job, body.opts || {}));
  const user = `Escreva a mensagem que o candidato vai enviar para a pessoa que abriu a vaga.

Canal: ${CANAIS[canal]}
Destinatário: ${body.recrutador || 'não informado (use saudação neutra)'}
Empresa: ${body.empresa || 'não informada'}
Tom: ${body.tom || 'profissional e direto'}
Objetivo: conseguir uma conversa de 15 minutos esta semana. Cite 2 ou 3 evidências concretas do currículo que batem com os requisitos obrigatórios. Se houver gap eliminatório, trate em uma frase honesta. Nada de listas longas.

<prefiltro_json>
${JSON.stringify(resumo, null, 1)}
</prefiltro_json>

<vaga>
${job}
</vaga>

<curriculo>
${cv}
</curriculo>`;
  return callModel(MensagemSchema, user);
}

// ---------------------------------------------------------------- http
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, status, body, type) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(fail('Corpo acima de 1 MB.', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(fail('JSON inválido.', 400)); } });
    req.on('error', reject);
  });
}

function apiError(e) {
  const nome = PROVIDER === 'openai' ? 'OpenAI' : 'Anthropic';
  if (e instanceof Anthropic.AuthenticationError || e instanceof OpenAI.AuthenticationError) return { status: 502, error: `Chave da ${nome} inválida ou ausente no servidor.` };
  if (e instanceof Anthropic.RateLimitError || e instanceof OpenAI.RateLimitError) return { status: 429, error: 'Limite de requisições da API atingido; tente de novo em instantes.' };
  if (e instanceof Anthropic.BadRequestError || e instanceof OpenAI.BadRequestError) return { status: 502, error: `A API da ${nome} rejeitou a requisição: ${e.message}` };
  if (e instanceof Anthropic.APIError || e instanceof OpenAI.APIError) return { status: 502, error: `Erro da API da ${nome} (${e.status}): ${e.message}` };
  return { status: e.status || 500, error: e.message || 'Erro interno.' };
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let status = 200;
  try {
    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, ai: !!client, provider: PROVIDER, model: MODEL, effort: EFFORT, aiError, chaves: KEYS });
    }
    if (url.pathname === '/api/analyze' || url.pathname === '/api/outreach') {
      if (req.method !== 'POST') { status = 405; return send(res, 405, { error: 'Use POST.' }); }
      if (!client) { status = 503; return send(res, 503, { error: 'IA indisponível no servidor: ' + aiError }); }
      const body = await readJson(req);
      const out = url.pathname === '/api/analyze' ? await analyze(body) : await outreach(body);
      return send(res, 200, out);
    }
    // estático
    const file = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const abs = path.resolve(ROOT, '.' + file);
    if (!abs.startsWith(ROOT + path.sep) || abs.includes(`${path.sep}node_modules${path.sep}`) || path.basename(abs).startsWith('.')) { status = 404; return send(res, 404, 'não encontrado', 'text/plain'); }
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { status = 404; return send(res, 404, 'não encontrado', 'text/plain'); }
    return send(res, 200, fs.readFileSync(abs), TYPES[path.extname(abs)] || 'application/octet-stream');
  } catch (e) {
    const { status: st, error } = apiError(e);
    status = st;
    return send(res, st, { error });
  } finally {
    // sem conteúdo de currículo/vaga no log, só método, rota, status e duração
    console.log(`${req.method} ${url.pathname} ${status} ${Date.now() - t0}ms`);
  }
});

server.listen(PORT, () => {
  console.log(`VagaMatch em http://localhost:${PORT}  (IA: ${client ? `ativa, ${PROVIDER} · ${MODEL} · effort ${EFFORT}` : 'inativa: ' + aiError})`);
});
