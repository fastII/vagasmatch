// engine.js — motor determinístico do VagaMatch: lê currículo + vaga e reproduz o filtro de um ATS.
// Roda no browser (script clássico) e no node (import com efeito colateral). Sem dependências.
// Tudo é explicável: cada componente do score tem o motivo ao lado.
(function (root) {
  const T = root.VagaMatchTaxonomy;
  if (!T) throw new Error('taxonomy.js precisa ser carregado antes de engine.js');

  // ---------------------------------------------------------------- util
  function normalize(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[–—]/g, '-')
      .replace(/[ \t]+/g, ' ');
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const B = '(?<![a-z0-9#+])';   // fronteira que entende c++, c#, .net, node.js
  const A = '(?![a-z0-9+])';
  const uniq = (arr) => Array.from(new Set(arr));
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function compile(list, hasCategory) {
    return list.map((row) => {
      const [name, cat, ...rest] = hasCategory ? row : [row[0], null, ...row.slice(1)];
      const custom = rest.length && typeof rest[rest.length - 1] === 'object' ? rest.pop().re : [];
      const parts = rest.map((a) => B + esc(normalize(a)) + A).concat(custom);
      return { name, cat, re: new RegExp('(' + parts.join('|') + ')', 'g') };
    });
  }
  const SKILLS = compile(T.skills, true);
  const CERTS = compile(T.certs, false);

  function findAll(norm, compiled) {
    const out = [];
    for (const s of compiled) {
      const m = norm.match(s.re);
      if (m) out.push({ name: s.name, cat: s.cat, hits: m.length, termos: uniq(m.map((x) => x.trim())) });
    }
    return out;
  }

  // ------------------------------------------------------- seções da vaga
  const H_REQ = /(requisitos|obrigator|necessari|imprescind|exigenc|must have|requirements|qualificac|o que esperamos|o que buscamos|what you.?ll need|what we.?re looking|voce precisa|precisamos que|perfil desejado|perfil da vaga|conhecimentos)/;
  const H_DES = /(diferenci|desejav|nice to have|plus|bonus|seria otimo|would be great|valorizamos|preferred|preferencial)/;
  const H_RESP = /(responsabilidad|atividades|atribuic|o que voce vai fazer|you will|what you.?ll do|dia a dia|rotina|desafios|missao|como sera)/;
  const H_OTHER = /(beneficio|benefits|sobre a empresa|sobre nos|about us|quem somos|processo seletivo|etapas|remuneracao|salario|o que oferecemos|perks|contratacao|modelo de trabalho|local de trabalho|horario)/;
  const L_DES = /(diferencial|desejavel|nice to have|e um plus|sera um plus|bonus points|preferivel|seria um diferencial)/;
  const L_REQ = /(obrigatorio|mandatorio|imprescindivel|must have|required|essencial|indispensavel)/;

  function splitJob(norm) {
    const buckets = { required: [], desired: [], resp: [], other: [] };
    let cur = null;
    let headings = 0;
    for (const raw of norm.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const isHeading = line.length <= 60 && !/[.;]$/.test(line);
      if (isHeading && H_DES.test(line)) { cur = 'desired'; headings++; continue; }
      if (isHeading && H_REQ.test(line)) { cur = 'required'; headings++; continue; }
      if (isHeading && H_RESP.test(line)) { cur = 'resp'; headings++; continue; }
      if (isHeading && H_OTHER.test(line)) { cur = 'other'; headings++; continue; }
      let b = cur || 'other';
      if (L_DES.test(line)) b = 'desired';
      else if (L_REQ.test(line)) b = 'required';
      buckets[b].push(line);
    }
    const semSecoes = headings === 0;
    if (semSecoes) {
      // Sem cabeçalhos: tudo que não foi marcado como diferencial conta como obrigatório.
      buckets.required = buckets.required.concat(buckets.other, buckets.resp);
      buckets.other = []; buckets.resp = [];
    }
    return { ...buckets, semSecoes, headings };
  }

  // ------------------------------------------------------- sinais
  const MON = '(?:jan|fev|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|set|sep|out|oct|nov|dez|dec)[a-z]*\\.?';
  const DATE = `(?:${MON}[\\s\\/.-]*(?:de\\s+)?|\\d{1,2}\\s*\\/\\s*)?(?:19|20)\\d{2}`;
  const NOW = '(?:atual|atualmente|presente|present|current|hoje|o momento|momento|now|today)';
  const RANGE = new RegExp(`(${DATE})\\s*(?:-|a|ate|to|\\||~)\\s*(${DATE}|${NOW})`, 'g');
  const MONTHS = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };

  function parseDateToken(tok, isEnd) {
    const now = new Date();
    if (new RegExp('^' + NOW + '$').test(tok)) return { y: now.getFullYear(), m: now.getMonth() + 1 };
    const y = Number((tok.match(/(19|20)\d{2}/) || [])[0]);
    if (!y) return null;
    let m = null;
    const mn = tok.match(/^([a-z]{3})/);
    if (mn && MONTHS[mn[1]]) m = MONTHS[mn[1]];
    const num = tok.match(/^(\d{1,2})\s*\//);
    if (num) m = clamp(Number(num[1]), 1, 12);
    if (m === null) m = isEnd ? 12 : 1;
    return { y, m };
  }

  // Soma de intervalos (união, em meses) encontrados num texto.
  function yearsFromRanges(norm) {
    const ivs = [];
    let m;
    RANGE.lastIndex = 0;
    while ((m = RANGE.exec(norm))) {
      const a = parseDateToken(m[1].trim(), false), b = parseDateToken(m[2].trim(), true);
      if (!a || !b) continue;
      const s = a.y * 12 + a.m, e = b.y * 12 + b.m;
      if (e < s || e - s > 40 * 12 || a.y < 1980) continue;
      ivs.push([s, e]);
    }
    if (!ivs.length) return { anos: null, intervalos: 0 };
    ivs.sort((x, y) => x[0] - y[0]);
    let total = 0, [cs, ce] = ivs[0];
    for (let i = 1; i < ivs.length; i++) {
      const [s, e] = ivs[i];
      if (s <= ce) ce = Math.max(ce, e);
      else { total += ce - cs + 1; [cs, ce] = [s, e]; }
    }
    total += ce - cs + 1;
    return { anos: Math.round((total / 12) * 10) / 10, intervalos: ivs.length };
  }

  function explicitYears(norm, strict) {
    // "5+ anos de experiência", "at least 3 years", "mais de 10 anos atuando"
    const re = /(\d{1,2})\s*\+?\s*(?:anos|ano|years|year|yrs)/g;
    let best = null, m;
    while ((m = re.exec(norm))) {
      // contexto = a frase do número (+40 chars antes, para pegar um cabeçalho "Experiência:")
      const sStart = Math.max(norm.lastIndexOf('.', m.index), norm.lastIndexOf('\n', m.index), norm.lastIndexOf(';', m.index)) + 1;
      let sEnd = norm.length;
      for (const ch of ['.', '\n', ';']) { const i = norm.indexOf(ch, m.index + m[0].length); if (i !== -1 && i < sEnd) sEnd = i; }
      const sentence = norm.slice(sStart, sEnd), before = norm.slice(Math.max(0, m.index - 40), m.index);
      const after = norm.slice(m.index + m[0].length, m.index + m[0].length + 30);
      if (strict && !/(experienc|experience|atuacao|atuando|trabalhando|carreira|vivencia|working)/.test(sentence + ' ' + before)) continue;
      if (/^\s*(de\s+|no\s+)?(mercado|empresa|idade|existencia|historia|fundad)/.test(after)) continue;
      const n = Number(m[1]);
      if (n > 0 && n <= 40 && (best === null || n > best)) best = n;
    }
    return best;
  }

  const SENIOR = [
    { rank: 0, label: 'estágio', re: /(estagi|intern\b|trainee)/ },
    { rank: 1, label: 'júnior', re: /(junior|\bjr\b|\bjr\.)/ },
    { rank: 2, label: 'pleno', re: /(pleno|mid-level|mid level|middle|\bmid\b|intermediate level)/ },
    { rank: 3, label: 'sênior', re: /(senior|\bsr\b|\bsr\.)/ },
    { rank: 4, label: 'especialista/lead', re: /(especialista|specialist|\bstaff\b|principal|\blead\b|tech lead|lider tecnico|arquitet[oa]\b|(?<!certified )(?:solutions |cloud |software |enterprise )?architect(?! associate| professional| certif)|\bhead\b|coordenador|gerente|manager)/ },
  ];
  function seniority(norm, titleFirst) {
    const head = norm.slice(0, 200);
    if (titleFirst) {
      const inTitle = SENIOR.filter((s) => s.re.test(head));
      if (inTitle.length) return inTitle.reduce((a, b) => (b.rank > a.rank ? b : a));
    }
    const found = SENIOR.filter((s) => s.re.test(norm));
    if (!found.length) return null;
    return found.reduce((a, b) => (b.rank > a.rank ? b : a));
  }

  const LEVELS = [null, 'básico', 'intermediário', 'avançado', 'fluente'];
  function english(norm) {
    const re = /(ingles|english)/g;
    let m, best = null, mentioned = false;
    while ((m = re.exec(norm))) {
      mentioned = true;
      const ctx = norm.slice(Math.max(0, m.index - 40), m.index + 60);
      let lvl = null;
      if (/(fluente|fluent|nativo|native|proficien|c1|c2)/.test(ctx)) lvl = 4;
      else if (/(avancado|advanced|b2)/.test(ctx)) lvl = 3;
      else if (/(intermediario|intermediate|b1)/.test(ctx)) lvl = 2;
      else if (/(basico|basic|a1|a2|leitura|tecnico)/.test(ctx)) lvl = 1;
      if (lvl !== null && (best === null || lvl > best)) best = lvl;
    }
    if (!mentioned) return { nivel: null, label: null };
    const lvl = best === null ? 2 : best; // mencionado sem nível: intermediário
    return { nivel: lvl, label: LEVELS[lvl] };
  }

  function education(norm) {
    const required = /(superior completo|ensino superior|graduacao completa|graduacao em|formacao superior|bacharel|degree in|bachelor|nivel superior|formacao em)/.test(norm);
    const has = /(bacharel|graduacao|graduado|formado em|tecnologo|licenciatura|bachelor|b\.?sc|engenharia|engenheiro|ciencia da computacao|ciencias da computacao|sistemas de informacao|analise e desenvolvimento|pos-graduacao|pos graduacao|mba|mestrado|mestre|doutorado|especializacao)/.test(norm);
    const cursando = /(cursando|em andamento|previsao de conclusao|incompleto)/.test(norm);
    return { required, has, cursando };
  }

  function workModel(norm) {
    if (/(remoto|remote|home office|home-office|100% remoto|trabalho remoto)/.test(norm)) return 'remoto';
    if (/(hibrido|hybrid)/.test(norm)) return 'híbrido';
    if (/(presencial|on-site|onsite|in-office)/.test(norm)) return 'presencial';
    return null;
  }
  const CITIES = ['sao paulo', 'rio de janeiro', 'belo horizonte', 'curitiba', 'porto alegre', 'florianopolis', 'brasilia', 'salvador', 'recife', 'fortaleza', 'campinas', 'goiania', 'manaus', 'belem', 'vitoria', 'joinville', 'londrina', 'uberlandia', 'sorocaba', 'lisboa', 'porto', 'buenos aires', 'santiago', 'bogota', 'cidade do mexico', 'mexico city', 'miami', 'new york', 'londres', 'london', 'madrid', 'barcelona'];
  function city(norm) { return CITIES.find((c) => new RegExp(B + esc(c) + A).test(norm)) || null; }

  function contract(norm) {
    const out = [];
    if (/\bclt\b/.test(norm)) out.push('CLT');
    if (/\bpj\b|pessoa juridica/.test(norm)) out.push('PJ');
    if (/(cooperado|freelancer|temporario|contractor)/.test(norm)) out.push('outro');
    return out;
  }

  // ------------------------------------------------------- currículo
  const H_EXP = /^(experiencia|experiencias|experience|historico profissional|trajetoria|carreira|atuacao profissional|employment|work experience|professional experience)/;
  const H_CV_OTHER = /^(formacao|educacao|education|academic|academica|cursos|certificac|idiomas|languages|habilidades|skills|competencias|tecnologias|conhecimentos|projetos|resumo|sobre|objetivo|summary|contato|ferramentas|stack|perfil|informacoes|interesses|voluntariado|publicacoes)/;

  function cvSections(norm) {
    const exp = [];
    let inExp = false, hasExpHeading = false;
    for (const raw of norm.split('\n')) {
      const line = raw.trim().replace(/^[-•*#>\s]+/, '');
      if (!line) continue;
      const short = line.length <= 45;
      if (short && H_EXP.test(line)) { inExp = true; hasExpHeading = true; continue; }
      if (short && H_CV_OTHER.test(line)) { inExp = false; continue; }
      if (inExp) exp.push(line);
    }
    return { expText: exp.join('\n'), hasExpHeading };
  }

  function cvFormat(raw, norm, sections) {
    const words = norm.split(/\s+/).filter(Boolean).length;
    const email = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(norm);
    const phone = /(\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4})|(\+\d{1,3}\s?\d{2,3}\s?9?\d{4}[-\s]?\d{4})/.test(norm);
    const linkedin = /linkedin\.com\//.test(norm);
    const github = /github\.com\//.test(norm);
    const dates = (norm.match(/(19|20)\d{2}/g) || []).length;
    const summary = /(resumo|sobre mim|perfil profissional|objetivo|summary|about me|profile)/.test(norm.slice(0, 1200));
    const bullets = (raw.match(/^\s*[-•*]\s+/gm) || []).length;
    const flags = [];
    if (!email) flags.push({ nivel: 'critico', msg: 'Sem e-mail detectável. ATS indexa contato; recrutador não acha você.' });
    if (!phone) flags.push({ nivel: 'atencao', msg: 'Sem telefone detectável.' });
    if (!linkedin) flags.push({ nivel: 'atencao', msg: 'Sem URL do LinkedIn. Recrutadores cruzam perfil e currículo.' });
    if (words < 200) flags.push({ nivel: 'critico', msg: `Currículo curto (${words} palavras): pouca densidade de palavras-chave para o ATS.` });
    if (words > 1500) flags.push({ nivel: 'atencao', msg: `Currículo longo (${words} palavras): recrutador lê em 6 a 8 segundos; corte para 2 páginas.` });
    if (!sections.hasExpHeading) flags.push({ nivel: 'atencao', msg: 'Não achei um título "Experiência": parsers de ATS dependem de seções padrão (Experiência, Formação, Habilidades).' });
    if (dates < 2) flags.push({ nivel: 'critico', msg: 'Sem datas nas experiências. Sem datas o ATS não calcula anos de experiência.' });
    if (!summary) flags.push({ nivel: 'leve', msg: 'Sem resumo no topo. Um resumo de 3 linhas com as palavras-chave da vaga melhora o ranking.' });
    if (bullets < 3) flags.push({ nivel: 'leve', msg: 'Poucos bullets. Resultados em bullets ("reduzi X em Y%") são lidos mais rápido.' });
    const score = clamp(1 - flags.reduce((s, f) => s + (f.nivel === 'critico' ? 0.3 : f.nivel === 'atencao' ? 0.12 : 0.05), 0), 0, 1);
    return { words, email, phone, linkedin, github, dates, summary, bullets, flags, score };
  }

  function candidateName(raw) {
    const first = String(raw || '').split('\n').map((l) => l.trim()).find((l) => l);
    if (!first) return null;
    if (first.split(/\s+/).length <= 5 && !/[\d@|:/]/.test(first) && first.length <= 60) return first.replace(/^[-•*#\s]+/, '');
    return null;
  }

  // ------------------------------------------------------- análise principal
  function analyze(cvRaw, jobRaw, opts) {
    opts = opts || {};
    const cvN = normalize(cvRaw), jobN = normalize(jobRaw);
    const job = splitJob(jobN);
    const reqText = job.required.concat(job.resp).join('\n');
    const desText = job.desired.join('\n');

    const reqSkills = findAll(reqText, SKILLS);
    const desSkills = findAll(desText, SKILLS).filter((d) => !reqSkills.some((r) => r.name === d.name));
    const cvSkills = findAll(cvN, SKILLS);
    const cvMap = Object.fromEntries(cvSkills.map((s) => [s.name, s]));

    const mark = (list) => list.map((s) => {
      const c = cvMap[s.name];
      const mesmoTermo = !!(c && c.termos.some((t) => s.termos.includes(t)));
      return { ...s, ok: !!c, cvTermos: c ? c.termos : [], mesmoTermo };
    });
    const required = mark(reqSkills), desired = mark(desSkills);
    const extras = cvSkills.filter((s) => !reqSkills.some((r) => r.name === s.name) && !desSkills.some((d) => d.name === s.name));

    const reqCerts = findAll(reqText, CERTS);
    const cvCerts = findAll(cvN, CERTS);
    const certsMissing = reqCerts.filter((c) => !cvCerts.some((x) => x.name === c.name));

    // sinais
    const sec = cvSections(cvN);
    const fromRanges = yearsFromRanges(sec.hasExpHeading ? sec.expText : cvN);
    const cvExplicit = explicitYears(cvN, true);
    const cvYears = Math.max(fromRanges.anos || 0, cvExplicit || 0) || null;
    const jobYears = explicitYears(reqText + '\n' + desText, true);
    const jobSen = seniority(jobN, true);
    const cvSen = seniority(cvN.slice(0, 400), false) || (sec.hasExpHeading && seniority(sec.expText, false)) || seniority(cvN, false);
    const jobEng = english(reqText + '\n' + desText), cvEng = english(cvN);
    const jobEdu = education(reqText), cvEdu = education(cvN);
    const jobModel = workModel(jobN), jobCity = city(jobN), cvCity = city(cvN);
    const jobContract = contract(jobN);
    const fmt = cvFormat(cvRaw, cvN, sec);

    // componentes do score (0..1) com explicação
    const comp = {};
    const reqOk = required.filter((s) => s.ok).length;
    comp.required = {
      peso: 45, valor: required.length ? reqOk / required.length : 1,
      texto: required.length ? `${reqOk} de ${required.length} requisitos obrigatórios encontrados no currículo` : 'A vaga não lista tecnologias obrigatórias reconhecíveis',
    };
    const desOk = desired.filter((s) => s.ok).length;
    comp.desired = {
      peso: desired.length ? 15 : 0, valor: desired.length ? desOk / desired.length : 1,
      texto: desired.length ? `${desOk} de ${desired.length} diferenciais encontrados` : 'Sem diferenciais listados',
    };
    if (!desired.length) comp.required.peso += 15;

    let yv = 1, yt = 'A vaga não exige anos de experiência explícitos';
    if (jobYears) {
      if (cvYears === null) { yv = 0.5; yt = `A vaga pede ${jobYears}+ anos; não consegui calcular os seus (faltam datas no currículo)`; }
      else { yv = clamp(cvYears / jobYears, 0, 1); yt = `A vaga pede ${jobYears}+ anos; detectei ${cvYears} anos no currículo`; }
    } else if (cvYears !== null) yt = `Detectei ${cvYears} anos de experiência no currículo`;
    comp.years = { peso: 15, valor: yv, texto: yt };

    let sv = 0.7, st = 'Senioridade da vaga não identificada';
    if (jobSen && cvSen) {
      const d = cvSen.rank - jobSen.rank;
      sv = d >= 0 ? 1 : d === -1 ? 0.6 : 0.2;
      st = `Vaga ${jobSen.label}, você aparece como ${cvSen.label}` + (d >= 0 ? '' : d === -1 ? ' (um degrau abaixo)' : ' (dois ou mais degraus abaixo)');
    } else if (jobSen) st = `Vaga ${jobSen.label}; seu nível não está explícito no currículo (coloque no título)`;
    comp.seniority = { peso: 10, valor: sv, texto: st };

    let ev = 1, et = 'A vaga não pede inglês';
    if (jobEng.nivel) {
      if (!cvEng.nivel) { ev = 0; et = `A vaga pede inglês ${jobEng.label}; seu currículo não menciona inglês`; }
      else { const d = cvEng.nivel - jobEng.nivel; ev = d >= 0 ? 1 : d === -1 ? 0.5 : 0; et = `A vaga pede inglês ${jobEng.label}; você declara ${cvEng.label}`; }
    }
    comp.english = { peso: 5, valor: ev, texto: et };

    let dv = 1, dt = 'A vaga não exige formação superior explícita';
    if (jobEdu.required) {
      if (cvEdu.has && !cvEdu.cursando) dt = 'Formação superior exigida e presente';
      else if (cvEdu.has && cvEdu.cursando) { dv = 0.6; dt = 'Formação superior exigida; a sua consta como em andamento'; }
      else { dv = 0; dt = 'Formação superior exigida e não encontrada no currículo'; }
    }
    comp.education = { peso: 5, valor: dv, texto: dt };
    comp.format = { peso: 5, valor: fmt.score, texto: fmt.flags.length ? `${fmt.flags.length} ajuste(s) de formato para o parser do ATS` : 'Formato legível para o ATS' };

    const totalPeso = Object.values(comp).reduce((s, c) => s + c.peso, 0);
    let score = Math.round(Object.values(comp).reduce((s, c) => s + c.peso * c.valor, 0) / totalPeso * 100);

    // knockouts: o que um ATS reprova sem humano olhar
    const knockouts = [];
    if (jobYears && cvYears !== null && cvYears < jobYears * 0.75) knockouts.push(`Anos de experiência abaixo do mínimo (${cvYears} < ${jobYears}).`);
    if (jobEng.nivel && (!cvEng.nivel || cvEng.nivel < jobEng.nivel)) knockouts.push(`Inglês ${jobEng.label} exigido; currículo ${cvEng.nivel ? 'declara ' + cvEng.label : 'não menciona inglês'}.`);
    if (jobEdu.required && !cvEdu.has) knockouts.push('Formação superior exigida e ausente no currículo.');
    for (const c of certsMissing) knockouts.push(`Certificação exigida não encontrada: ${c.name}.`);
    if (required.length >= 3 && reqOk === 0) knockouts.push('Nenhum requisito obrigatório encontrado: sem aderência técnica.');
    const atencao = [];
    if ((jobModel === 'presencial' || jobModel === 'híbrido') && jobCity && cvCity && jobCity !== cvCity) atencao.push(`Vaga ${jobModel} em ${jobCity}; seu currículo indica ${cvCity}. Pergunta eliminatória comum: disponibilidade para o local.`);
    if (jobContract.length === 1 && jobContract[0] === 'PJ' && /\bclt\b/.test(cvN) && !/\bpj\b/.test(cvN)) atencao.push('Vaga PJ; se você só aceita CLT, isso é eliminatório na triagem.');
    if (job.semSecoes) atencao.push('A vaga não separa obrigatórios de diferenciais; tratei toda tecnologia citada como obrigatória.');
    if (knockouts.length) score = Math.min(score, 59);

    const band = score >= 80 ? 'Forte' : score >= 65 ? 'Bom' : score >= 50 ? 'Limítrofe' : 'Fraco';
    const veredito = knockouts.length
      ? 'Provável reprovação automática: há critérios eliminatórios não atendidos.'
      : score >= 65 ? 'Provável passagem pelo filtro automático; a disputa é no ranking.' : 'Risco de ficar fora do corte do ATS.';

    // sugestões acionáveis
    const sugestoes = [];
    for (const s of required.filter((x) => !x.ok)) sugestoes.push({ tipo: 'gap', msg: `Falta "${s.name}" (obrigatório). Se você já usou, cite com contexto: projeto, ano e resultado. Se não, trate no contato com o recrutador.` });
    for (const s of required.concat(desired).filter((x) => x.ok && !x.mesmoTermo)) sugestoes.push({ tipo: 'termo', msg: `Use o termo da vaga: "${s.termos[0]}" (seu currículo diz "${s.cvTermos[0]}"). Busca por palavra-chave é literal.` });
    for (const s of desired.filter((x) => !x.ok).slice(0, 3)) sugestoes.push({ tipo: 'diferencial', msg: `Diferencial "${s.name}" ausente; vale citar se houver base, mesmo que em estudo.` });
    if (jobSen && cvSen && cvSen.rank < jobSen.rank) sugestoes.push({ tipo: 'senioridade', msg: `Título do currículo abaixo da vaga (${cvSen.label} vs ${jobSen.label}). Se você já atua no nível, ajuste o título e os verbos (liderei, defini, desenhei).` });
    if (jobEng.nivel && !cvEng.nivel) sugestoes.push({ tipo: 'idioma', msg: 'Inclua uma linha "Inglês: nível" no currículo; sem ela o filtro assume que você não tem.' });
    for (const f of fmt.flags) sugestoes.push({ tipo: 'formato', msg: f.msg });

    const cargo = opts.cargo || String(jobRaw || '').split('\n').map((l) => l.trim()).find((l) => l) || 'a vaga';
    const result = {
      score, band, veredito, knockouts, atencao, componentes: comp,
      skills: { required, desired, extras, certsRequired: reqCerts, certsMissing },
      sinais: {
        cvYears, jobYears, cvSeniority: cvSen ? cvSen.label : null, jobSeniority: jobSen ? jobSen.label : null,
        cvEnglish: cvEng.label, jobEnglish: jobEng.label, cvEducation: cvEdu.has, jobEducationRequired: jobEdu.required,
        jobModel, jobCity, cvCity, jobContract, semSecoes: job.semSecoes,
      },
      formato: fmt, sugestoes,
      meta: { cargo: cargo.slice(0, 80), empresa: opts.empresa || null, recrutador: opts.recrutador || null, candidato: candidateName(cvRaw), geradoEm: new Date().toISOString() },
    };
    result.mensagem = buildMessage(result, opts.canal || 'linkedin_mensagem', cvN);
    return result;
  }

  // ------------------------------------------------------- mensagem (sem IA)
  function buildMessage(r, canal, cvN) {
    const nome = r.meta.recrutador ? r.meta.recrutador.split(' ')[0] : null;
    const saud = nome ? `Olá, ${nome}!` : 'Olá!';
    const cargo = r.meta.cargo, empresa = r.meta.empresa ? ` na ${r.meta.empresa}` : '';
    const fortes = r.skills.required.filter((s) => s.ok).map((s) => s.name);
    const dif = r.skills.desired.filter((s) => s.ok).map((s) => s.name);
    const falta = r.skills.required.filter((s) => !s.ok).map((s) => s.name);
    const anos = r.sinais.cvYears ? `${Math.round(r.sinais.cvYears)} anos de experiência` : 'experiência consolidada';
    const email = (cvN.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/) || [])[0];
    const assina = r.meta.candidato ? `\n${r.meta.candidato}` : '';
    const top = fortes.slice(0, 3).join(', ') || dif.slice(0, 2).join(', ') || 'a stack da vaga';

    if (canal === 'linkedin_nota') {
      const s = `${saud} Vi a vaga de ${cargo}${empresa}. Tenho ${anos} com ${fortes.slice(0, 2).join(' e ') || top} e encaixo nos requisitos principais. Podemos falar 15 min?`;
      return s.length <= 300 ? s : s.slice(0, 297) + '...';
    }
    const gap = falta.length
      ? `\n\nPonto que prefiro alinhar logo: ainda não trabalhei com ${falta[0]} no dia a dia${dif.length || fortes.length > 3 ? `, mas tenho base próxima em ${(fortes.slice(3).concat(dif))[0] || fortes[0]}` : ''}.`
      : '';
    const corpo = `${saud} Vi a vaga de ${cargo}${empresa} e quero me candidatar de forma objetiva.

Meu encaixe, em três linhas:
• ${anos}${r.sinais.cvSeniority ? `, atuando como ${r.sinais.cvSeniority}` : ''}
• Domínio em ${top}${dif.length ? `\n• Diferenciais da vaga que já pratico: ${dif.slice(0, 3).join(', ')}` : ''}${gap}

Posso conversar 15 minutos esta semana? Fico à disposição${email ? ` em ${email}` : ''}.${assina}`;
    if (canal === 'email') return `Assunto: ${cargo} — candidatura objetiva\n\n${corpo}`;
    return corpo;
  }

  // resumo compacto para mandar à IA (sem o currículo inteiro duplicado)
  function summary(r) {
    return {
      score: r.score, band: r.band, veredito: r.veredito, knockouts: r.knockouts, atencao: r.atencao,
      obrigatorios_ok: r.skills.required.filter((s) => s.ok).map((s) => s.name),
      obrigatorios_faltando: r.skills.required.filter((s) => !s.ok).map((s) => s.name),
      diferenciais_ok: r.skills.desired.filter((s) => s.ok).map((s) => s.name),
      diferenciais_faltando: r.skills.desired.filter((s) => !s.ok).map((s) => s.name),
      extras_do_candidato: r.skills.extras.map((s) => s.name).slice(0, 25),
      sinais: r.sinais, formato_flags: r.formato.flags.map((f) => f.msg), cargo: r.meta.cargo, empresa: r.meta.empresa,
    };
  }

  root.VagaMatchEngine = { analyze, buildMessage, summary, normalize, _internals: { splitJob, yearsFromRanges, explicitYears, seniority, english, education, findAll, SKILLS, CERTS } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
