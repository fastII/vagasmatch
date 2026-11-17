"""Camada de IA: Claude (Anthropic) ou GPT (OpenAI) pelo mesmo contrato de saída estruturada.

Porta fiel do prototype/server.js. Nada é persistido aqui: currículo e vaga passam pela
requisição e morrem com ela, e nunca vão para log.
"""
import json
import re
from typing import Literal

import anthropic
import openai
from pydantic import BaseModel, Field

from . import config

SYSTEM = """Você é um tech recruiter sênior, especialista em triagem com ATS (Gupy, Greenhouse, Lever, Workday, LinkedIn Recruiter) e em contratação de tecnologia no Brasil.

Regras fixas:
1. Nunca invente experiência, ferramenta, número ou resultado que não esteja no currículo. Se faltar, diga como o candidato deve tratar o gap com honestidade.
2. Responda em português do Brasil, direto, sem clichês ("apaixonado por tecnologia", "mentalidade de dono") e sem bajulação.
3. Pense como o ATS e como o humano que lê em 8 segundos: critérios eliminatórios primeiro, depois ranking por palavras-chave literais da vaga, depois evidência (projeto, ano, resultado).
4. Mensagens para quem abriu a vaga: curtas, específicas, em primeira pessoa (quem envia é o candidato), com um pedido claro (conversa de 15 minutos). Nota de conexão no LinkedIn: no máximo 300 caracteres. Mensagem no LinkedIn: no máximo 900. E-mail: assunto objetivo com o nome da vaga.
5. Toda recomendação de currículo deve ser um trecho pronto para colar, no vocabulário literal da vaga."""


# ---------------------------------------------------------------- esquemas de saída
class Gap(BaseModel):
    requisito: str
    gravidade: Literal["eliminatorio", "importante", "leve"]
    como_tratar: str = Field(description="O que dizer ou fazer, com honestidade")


class AjusteCurriculo(BaseModel):
    onde: str = Field(description="Seção ou linha do currículo")
    trecho_sugerido: str = Field(description="Texto pronto para colar, sem inventar fatos")
    motivo: str


class PerguntaTriagem(BaseModel):
    pergunta: str = Field(description="Pergunta que o recrutador tende a fazer para esta vaga")
    resposta_sugerida: str = Field(description="Resposta curta, baseada só no currículo")


class Analise(BaseModel):
    score_ia: float = Field(description="0 a 100, chance de passar da triagem para a entrevista")
    veredito: str = Field(description="Uma frase objetiva")
    pontos_fortes: list[str] = Field(description="Até 6, cada um citando a evidência do currículo")
    gaps: list[Gap] = Field(description="Até 8")
    riscos_ats: list[str] = Field(description="Até 6 riscos de parser, palavra-chave ou pergunta eliminatória")
    ajustes_curriculo: list[AjusteCurriculo] = Field(description="Até 6")
    perguntas_triagem: list[PerguntaTriagem] = Field(description="Até 6")


class Mensagem(BaseModel):
    assunto: str = Field(description="Só para e-mail; vazio nos outros canais")
    mensagem: str = Field(description="Texto final, pronto para enviar, respeitando o limite do canal")
    follow_up: str = Field(description="Mensagem curta de follow-up para 5 dias úteis depois, caso não haja resposta")


CANAIS = {
    "linkedin_nota": "nota de conexão no LinkedIn (máximo 300 caracteres, sem assunto)",
    "linkedin_mensagem": "mensagem direta no LinkedIn (máximo 900 caracteres, sem assunto)",
    "email": "e-mail (assunto objetivo + corpo de até 180 palavras)",
}


class Fail(Exception):
    def __init__(self, msg: str, status: int = 502):
        super().__init__(msg)
        self.status = status


# ---------------------------------------------------------------- cliente
client = None
if config.PROVIDER == "openai":
    client = openai.OpenAI()
elif config.PROVIDER == "anthropic":
    client = anthropic.Anthropic()


def _call_anthropic(schema: type[BaseModel], user_text: str) -> dict:
    resp = client.beta.messages.parse(
        model=config.MODEL,
        max_tokens=config.MAX_OUTPUT_TOKENS,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
        output_config={"effort": config.EFFORT},
        output_format=schema,
        messages=[{"role": "user", "content": user_text}],
    )
    if resp.stop_reason == "refusal":
        why = getattr(getattr(resp, "stop_details", None), "explanation", None)
        raise Fail("O modelo recusou a solicitação" + (f": {why}" if why else "."))
    if resp.stop_reason == "max_tokens":
        raise Fail("Resposta truncada (max_tokens).")
    data = resp.parsed_output
    if data is None:
        raise Fail("Resposta da IA fora do esquema esperado.")
    u = resp.usage
    return {
        "data": data.model_dump(),
        "provider": "anthropic",
        "model": resp.model or config.MODEL,
        "usage": {
            "input_tokens": u.input_tokens,
            "output_tokens": u.output_tokens,
            "cache_read_input_tokens": getattr(u, "cache_read_input_tokens", 0) or 0,
        },
    }


_OPENAI_REASONING = re.compile(r"^(gpt-5|o[1-9])")  # modelos que aceitam reasoning.effort


def _call_openai(schema: type[BaseModel], user_text: str) -> dict:
    extra = {"reasoning": {"effort": config.EFFORT}} if _OPENAI_REASONING.match(config.MODEL) else {}
    resp = client.responses.parse(
        model=config.MODEL,
        instructions=SYSTEM,
        input=user_text,
        max_output_tokens=config.MAX_OUTPUT_TOKENS,
        text_format=schema,
        **extra,
    )
    if resp.status == "incomplete":
        reason = getattr(resp.incomplete_details, "reason", None) or "incompleta"
        raise Fail(f"Resposta truncada ({reason}).")
    for item in resp.output or []:
        for c in getattr(item, "content", None) or []:
            if getattr(c, "type", "") == "refusal":
                raise Fail("O modelo recusou a solicitação: " + c.refusal)
    data = resp.output_parsed
    if data is None:
        raise Fail("Resposta da IA fora do esquema esperado.")
    u = resp.usage
    cached = getattr(getattr(u, "input_tokens_details", None), "cached_tokens", 0) or 0
    return {
        "data": data.model_dump(),
        "provider": "openai",
        "model": resp.model or config.MODEL,
        "usage": {"input_tokens": u.input_tokens, "output_tokens": u.output_tokens, "cache_read_input_tokens": cached},
    }


def _call_model(schema: type[BaseModel], user_text: str) -> dict:
    return _call_openai(schema, user_text) if config.PROVIDER == "openai" else _call_anthropic(schema, user_text)


# ---------------------------------------------------------------- prompts
def _clip(s, n: int) -> str:
    s = str(s or "")
    return s[:n] + "\n[...cortado...]" if len(s) > n else s


def _prefiltro(resumo) -> str:
    if not resumo:
        return "<prefiltro_json>\n(não enviado: o cliente não rodou o filtro determinístico)\n</prefiltro_json>"
    return "<prefiltro_json>\n" + json.dumps(resumo, ensure_ascii=False, indent=1) + "\n</prefiltro_json>"


def analyze(body: dict) -> dict:
    cv, job = _clip(body.get("cv"), 20000), _clip(body.get("job"), 12000)
    if not cv.strip() or not job.strip():
        raise Fail("Envie cv e job.", 400)
    user = f"""Avalie este candidato para esta vaga como o ATS e o recrutador fariam. Use o pré-filtro determinístico abaixo como ponto de partida, mas discorde quando o currículo justificar.

{_prefiltro(body.get("resumo"))}

<vaga>
{job}
</vaga>

<curriculo>
{cv}
</curriculo>"""
    return _call_model(Analise, user)


def outreach(body: dict) -> dict:
    cv, job = _clip(body.get("cv"), 20000), _clip(body.get("job"), 12000)
    if not cv.strip() or not job.strip():
        raise Fail("Envie cv e job.", 400)
    canal = body.get("canal") if body.get("canal") in CANAIS else "linkedin_mensagem"
    user = f"""Escreva a mensagem que o candidato vai enviar para a pessoa que abriu a vaga.

Canal: {CANAIS[canal]}
Destinatário: {body.get("recrutador") or "não informado (use saudação neutra)"}
Empresa: {body.get("empresa") or "não informada"}
Tom: {body.get("tom") or "profissional e direto"}
Objetivo: conseguir uma conversa de 15 minutos esta semana. Cite 2 ou 3 evidências concretas do currículo que batem com os requisitos obrigatórios. Se houver gap eliminatório, trate em uma frase honesta. Nada de listas longas.

{_prefiltro(body.get("resumo"))}

<vaga>
{job}
</vaga>

<curriculo>
{cv}
</curriculo>"""
    return _call_model(Mensagem, user)


# ---------------------------------------------------------------- erros
def api_error(e: Exception) -> tuple[int, str]:
    nome = "OpenAI" if config.PROVIDER == "openai" else "Anthropic"
    msg = getattr(e, "message", None) or str(e)
    if isinstance(e, Fail):
        return e.status, str(e)
    if isinstance(e, (anthropic.AuthenticationError, openai.AuthenticationError)):
        return 502, f"Chave da {nome} inválida ou ausente no servidor."
    if isinstance(e, (anthropic.RateLimitError, openai.RateLimitError)):
        return 429, "Limite de requisições da API atingido; tente de novo em instantes."
    if isinstance(e, (anthropic.BadRequestError, openai.BadRequestError)):
        return 502, f"A API da {nome} rejeitou a requisição: {msg}"
    if isinstance(e, (anthropic.APIStatusError, openai.APIStatusError)):
        return 502, f"Erro da API da {nome} ({e.status_code}): {msg}"
    if isinstance(e, (anthropic.APIError, openai.APIError)):
        return 502, f"Erro da API da {nome}: {msg}"
    return 500, "Erro interno."
