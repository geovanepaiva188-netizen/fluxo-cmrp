// Fluxo CMRP — app (PC e celular). Sem framework: HTML gerado aqui, dados do Firestore em tempo real.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, onSnapshot, writeBatch, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, DOMINIO_MATRICULA, USAR_EMULADOR } from "./firebase-config.js";

/* ------------------------------------------------------------------ base */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
if (USAR_EMULADOR) { connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true }); connectFirestoreEmulator(db, "127.0.0.1", 8080); }

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const agoraIso = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4); return d.toISOString().slice(0, 16); };
const parse = s => s ? new Date(String(s).length === 16 ? s + ":00" : s) : null;
const hm = d => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dm = d => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const fmt = s => { const d = parse(s); return d && !isNaN(d) ? dm(d) + " " + hm(d) : ""; };
const fmtS = s => { const d = parse(s); if (!d || isNaN(d)) return ""; return d.toDateString() === new Date().toDateString() ? hm(d) : dm(d) + " " + hm(d); };
const dayKey = s => (s || "").slice(0, 10);
const dayLabel = k => { if (!k) return "Sem data"; const d = new Date(k + "T12:00:00"), t = new Date(), y = new Date(Date.now() - 864e5); if (d.toDateString() === t.toDateString()) return "Hoje"; if (d.toDateString() === y.toDateString()) return "Ontem"; return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" }); };
const money = s => { if (!s) return 0; const n = Number(String(s).replace(/[^\d,]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
const brl = v => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const matEmail = m => String(m || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "") + "@" + DOMINIO_MATRICULA;
function toast(m) { document.querySelectorAll(".toast").forEach(x => x.remove()); const t = document.createElement("div"); t.className = "toast"; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); }
function abrir(html, ligar) { $("dlg-body").innerHTML = html; if (!$("dlg").open) $("dlg").showModal(); ligar && ligar($("dlg-body")); }
function fechar() { $("dlg").open && $("dlg").close(); }
$("dlg").addEventListener("click", e => { if (e.target === $("dlg")) fechar(); });
const erroMsg = e => ({ "auth/invalid-credential": "Matrícula ou senha incorretas.", "auth/wrong-password": "Matrícula ou senha incorretas.", "auth/user-not-found": "Matrícula não encontrada.", "auth/email-already-in-use": "Essa matrícula já está cadastrada.", "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.", "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.", "permission-denied": "Sem permissão para isso." }[e?.code] || e?.message || "Algo deu errado.");

const STL = { aprovado: "Aprovado", pendente: "Pendente", devolvido: "Devolvido", conferir: "Conferir", encerrado: "Encerrado" };
const EQL = { em_dia: "Em dia", faltando: "BM faltando", pendente: "BM pendente", confirmar: "Confirmar", encerrado: "Encerrado", avulso: "Avulso" };
const ETL = { ok: "Aprovou", devolvido: "Devolveu", pendente: "Aguardando", folga: "Folga", ausente: "Ausente" };
const RSL = { aguardando: "Aguardando você", respondido: "Respondido", resolvido: "Resolvido", arquivado: "Sem resposta necessária" };

/* ------------------------------------------------------------------ estado */
const S = { gen: 0, user: null, perfil: null, procs: new Map(), procParts: [], resps: new Map(), avisos: new Map(), eqs: new Map(), obras: [], cfg: {}, robo: {}, conta: null, usuarios: [], contas: new Map(), unsub: [], tab: "fila", sub: "usuarios", f: {} };
const isAdmin = () => S.perfil?.papel === "admin";
const obraNome = c => { const o = S.obras.find(o => o.codigo === c); return o ? `${o.codigo === o.nome ? o.nome : o.codigo + " · " + o.nome}` : (c === "SEM_OBRA" ? "Obra não identificada" : c || "—"); };
function limparSubs() { S.unsub.forEach(u => { try { u(); } catch (e) { } }); S.unsub = []; }

/* ------------------------------------------------------------------ autenticação */
onAuthStateChanged(auth, async u => {
  limparSubs();
  S.user = u; S.perfil = null; S.f = {}; S.tab = "fila";
  if (!u) return telaEntrada("entrar");
  const ref = doc(db, "usuarios", u.uid);
  S.unsub.push(onSnapshot(ref, snap => { if (snap.metadata?.hasPendingWrites) return;
    const antes = JSON.stringify(S.perfil && { s: S.perfil.status, p: S.perfil.papel, v: S.perfil.ver, r: S.perfil.rh });
    S.perfil = snap.exists() ? snap.data() : null;
    const depois = JSON.stringify(S.perfil && { s: S.perfil.status, p: S.perfil.papel, v: S.perfil.ver, r: S.perfil.rh });
    if (!S.perfil) return telaEntrada("completar");
    if (S.perfil.status !== "ativo") return telaEspera();
    if (antes !== depois) iniciarApp();
  }, () => telaEntrada("entrar")));
});

async function telaEntrada(modo) {
  const gen = ++S.gen;
  let inicial = false;
  try { inicial = !(await getDoc(doc(db, "config", "inicializado"))).exists(); } catch (e) { }
  if (gen !== S.gen) return; // outra tela já foi aberta enquanto esperava
  if ((modo === "entrar" || modo === "completar") && inicial) modo = "inicial";
  const T = {
    entrar: ["Entrar", "Use sua matrícula e senha."],
    pedir: ["Solicitar acesso", "O administrador precisa aprovar seu cadastro."],
    completar: ["Completar cadastro", "Falta enviar seus dados para o administrador aprovar."],
    inicial: ["Criar administrador", "Primeiro acesso ao app: este cadastro vira o administrador."]
  }[modo];
  const campos = modo === "entrar" ? "" : `
    <label class="f">Nome<input id="a-nome" autocomplete="name" required></label>
    <label class="f">E-mail de contato <span class="opt">(LocaWeb)</span><input id="a-email" type="email" autocomplete="email" placeholder="voce@cmrp-pb.com.br"></label>
    <label class="f">Obra principal <span class="opt">(opcional)</span><input id="a-obra" placeholder="162"></label>`;
  $("app").innerHTML = `<div class="center"><div class="logo">FC</div>
    <form class="auth" id="fa" novalidate><h1>${T[0]}</h1><p>${T[1]}</p>
      ${!S.user ? `<label class="f">Matrícula<input id="a-mat" autocomplete="username" autocapitalize="characters" required></label>
      <label class="f">Senha<input id="a-senha" type="password" autocomplete="${modo === "entrar" ? "current-password" : "new-password"}" required></label>` : ""}
      ${campos}
      <div id="a-msg" class="alert bad" hidden></div>
      <button class="btn primary" type="submit">${modo === "entrar" ? "Entrar" : modo === "completar" ? "Enviar pedido" : modo === "inicial" ? "Criar administrador" : "Solicitar acesso"}</button>
      ${modo === "entrar" ? `<button class="link" type="button" id="a-pedir">Não tenho acesso — solicitar</button>` : ""}
      ${modo === "pedir" ? `<button class="link" type="button" id="a-voltar">Já tenho acesso — entrar</button>` : ""}
      ${modo === "completar" ? `<button class="link" type="button" id="a-sair">Sair</button>` : ""}
    </form></div>`;
  $("a-pedir") && ($("a-pedir").onclick = () => telaEntrada("pedir"));
  $("a-voltar") && ($("a-voltar").onclick = () => telaEntrada("entrar"));
  $("a-sair") && ($("a-sair").onclick = () => signOut(auth));
  $("fa").onsubmit = async e => {
    e.preventDefault();
    const msg = t => { $("a-msg").textContent = t; $("a-msg").hidden = !t; };
    msg("");
    const btn = e.submitter || $("fa").querySelector("button[type=submit]"); btn.disabled = true;
    try {
      if (modo === "entrar") { await signInWithEmailAndPassword(auth, matEmail($("a-mat").value), $("a-senha").value); return; }
      const nome = $("a-nome").value.trim(); if (!nome) throw { message: "Preencha o nome." };
      const mat = S.user ? (S.user.email || "").split("@")[0].toUpperCase() : $("a-mat").value.trim().toUpperCase();
      const base = { nome, matricula: mat, emailContato: ($("a-email").value || "").trim().toLowerCase(), obraPedido: ($("a-obra").value || "").trim(), criadoEm: agoraIso() };
      if (!S.user) { if (!mat) throw { message: "Preencha a matrícula." }; await createUserWithEmailAndPassword(auth, matEmail(mat), $("a-senha").value); }
      const uid = auth.currentUser.uid;
      if (modo === "inicial") {
        const b = writeBatch(db);
        b.set(doc(db, "usuarios", uid), { ...base, status: "ativo", papel: "admin", ver: { proprios: true, tudo: true, obras: [] }, rh: true, podeConectar: true, podeEncerrar: true, aprovadoEm: agoraIso() });
        b.set(doc(db, "config", "inicializado"), { em: agoraIso(), por: uid });
        await b.commit();
      } else {
        await setDoc(doc(db, "usuarios", uid), { ...base, status: "pendente", papel: "usuario", ver: { proprios: false, tudo: false, obras: [] }, rh: false, podeConectar: false, podeEncerrar: false });
      }
    } catch (err) { msg(erroMsg(err)); } finally { btn.disabled = false; }
  };
}

function telaEspera() {
  S.gen++;
  limparSubs();
  const st = S.perfil?.status;
  const txt = st === "pendente" ? ["Aguardando liberação", "Seu pedido foi enviado. Assim que o administrador aprovar, o app abre aqui sozinho."]
    : st === "suspenso" ? ["Acesso suspenso", "Fale com o administrador do Fluxo CMRP."] : ["Acesso recusado", "Fale com o administrador do Fluxo CMRP."];
  $("app").innerHTML = `<div class="center"><div class="logo">FC</div><div class="auth"><h1>${txt[0]}</h1><p>${txt[1]}</p>
    <p class="hint">Matrícula: <b>${esc(S.perfil?.matricula)}</b></p><button class="btn" id="b-sair">Sair</button></div></div>`;
  $("b-sair").onclick = () => signOut(auth);
  S.unsub.push(onSnapshot(doc(db, "usuarios", S.user.uid), s => { if (s.exists() && s.data().status === "ativo") { S.perfil = s.data(); iniciarApp(); } }));
}

/* ------------------------------------------------------------------ assinaturas de dados */
function consultasPermitidas(col, campoDono = true) {
  const p = S.perfil, base = collection(db, col), extra = (!isAdmin() && !p.rh && col === "processos") ? [where("rh", "==", false)] : [];
  if (isAdmin() || p.ver?.tudo) return [query(base, ...extra)];
  const qs = [];
  if (campoDono && p.ver?.proprios) { qs.push(query(base, where("dono", "==", S.user.uid), ...extra)); qs.push(query(base, where("copias", "array-contains", S.user.uid), ...extra)); }
  (p.ver?.obras || []).forEach(o => qs.push(query(base, where("obra", "==", o), ...extra)));
  return qs;
}
function assinarUniao(qs, mapa, aoMudar) {
  const partes = qs.map(() => new Map());
  qs.forEach((q, i) => S.unsub.push(onSnapshot(q, snap => {
    partes[i] = new Map(snap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    mapa.clear(); partes.forEach(pm => pm.forEach((v, k) => mapa.set(k, v)));
    aoMudar();
  }, e => console.warn(e))));
}
function iniciarApp() {
  S.gen++;
  limparSubs();
  S.procs.clear(); S.resps.clear(); S.avisos.clear(); S.eqs.clear();
  S.unsub.push(onSnapshot(doc(db, "usuarios", S.user.uid), s => { const n = s.data(); if (!n || n.status !== "ativo") { S.perfil = n; telaEspera(); return; } const mudou = JSON.stringify([n.papel, n.ver, n.rh, n.podeEncerrar, n.podeConectar]) !== JSON.stringify([S.perfil.papel, S.perfil.ver, S.perfil.rh, S.perfil.podeEncerrar, S.perfil.podeConectar]); S.perfil = n; if (mudou) iniciarApp(); }));
  casca();
  const atualizar = () => atualizarDados();
  assinarUniao(consultasPermitidas("processos"), S.procs, atualizar);
  assinarUniao(consultasPermitidas("equipamentos", false), S.eqs, atualizar);
  S.unsub.push(onSnapshot(query(collection(db, "responder"), where("dono", "==", S.user.uid)), s => { S.resps = new Map(s.docs.map(d => [d.id, { id: d.id, ...d.data() }])); atualizar(); }));
  S.unsub.push(onSnapshot(query(collection(db, "avisos"), where("para", "==", S.user.uid)), s => { S.avisos = new Map(s.docs.map(d => [d.id, { id: d.id, ...d.data() }])); badgeAvisos(); }));
  S.unsub.push(onSnapshot(collection(db, "obras"), s => { S.obras = s.docs.map(d => ({ codigo: d.id, ...d.data() })).sort((a, b) => a.codigo.localeCompare(b.codigo, "pt", { numeric: true })); atualizar(); }));
  S.unsub.push(onSnapshot(doc(db, "config", "geral"), s => { S.cfg = s.data() || {}; }));
  S.unsub.push(onSnapshot(doc(db, "config", "robo"), s => { S.robo = s.data() || {}; carimbo(); }));
  S.unsub.push(onSnapshot(doc(db, "contas", S.user.uid), s => { S.conta = s.exists() ? s.data() : null; if (S.tab === "conta") mostrar("conta"); }, () => { }));
  if (isAdmin()) {
    S.unsub.push(onSnapshot(collection(db, "usuarios"), s => { S.usuarios = s.docs.map(d => ({ uid: d.id, ...d.data() })); badgeAjustes(); if (S.tab === "ajustes" && S.sub === "usuarios") preencherAjustes(); }));
    S.unsub.push(onSnapshot(collection(db, "contas"), s => { S.contas = new Map(s.docs.map(d => [d.id, d.data()])); if (S.tab === "ajustes" && S.sub === "robo") preencherAjustes(); }));
  }
}

/* ------------------------------------------------------------------ casca */
const ABAS = [["fila", "Na fila"], ["responder", "A responder"], ["processos", "Processos"], ["arquivo", "Arquivo"], ["maquinas", "Máquinas"], ["pagamentos", "Pagamentos"], ["ajustes", "Ajustes"], ["conta", "Minha conta"]];
function casca() {
  const abas = ABAS.filter(a => a[0] !== "ajustes" || isAdmin());
  $("app").innerHTML = `<header><div class="wrap">
      <div class="head"><div><h1 class="t">Fluxo CMRP</h1><p class="sub" id="stamp"></p></div>
        <div class="icons"><button class="iconbtn" id="b-avisos" aria-label="Avisos">🔔<span class="n" id="n-avisos" hidden></span></button></div></div>
      <nav class="tabs" role="tablist">${abas.map(a => `<button class="tab" role="tab" data-tab="${a[0]}">${a[1]}<span class="n" id="n-${a[0]}"></span></button>`).join("")}</nav>
    </div></header><div class="wrap"><main id="main"></main></div>`;
  document.querySelectorAll(".tab").forEach(b => b.onclick = () => mostrar(b.dataset.tab));
  $("b-avisos").onclick = abrirAvisos;
  window.onhashchange = () => { const t = location.hash.slice(1); if (t && t !== S.tab && ABAS.some(a => a[0] === t)) mostrar(t); };
  const ini = location.hash.slice(1);
  mostrar(abas.some(a => a[0] === ini) ? ini : "fila");
  carimbo(); badgeAvisos(); badgeAjustes();
}
function carimbo() {
  const el = $("stamp"); if (!el) return;
  const r = S.robo?.ultimaRodada;
  el.innerHTML = `${esc(S.perfil?.nome || "")}${r ? ` · robô leu às <b>${esc(fmtS(r))}</b>` : " · robô ainda não rodou"}`;
}
function mostrar(tab) {
  S.tab = tab;
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === tab));
  if (location.hash.slice(1) !== tab) history.replaceState(null, "", "#" + tab);
  const V = { fila: vFila, responder: vResponder, processos: vProcessos, arquivo: vArquivo, maquinas: vMaquinas, pagamentos: vPagamentos, ajustes: vAjustes, conta: vConta };
  $("main").innerHTML = ""; (V[tab] || vFila)(); window.scrollTo(0, 0);
}
function atualizarDados() {
  const fila = [...S.procs.values()].filter(p => ["pendente", "devolvido", "conferir"].includes(p.status));
  const minhas = fila.filter(p => ["devolvido", "conferir"].includes(p.status) && (p.dono === S.user.uid || isAdmin()));
  const n = $("n-fila"); if (n) { n.textContent = fila.length || ""; n.classList.toggle("red", minhas.length > 0); }
  const r = [...S.resps.values()].filter(x => x.status === "aguardando").length; $("n-responder") && ($("n-responder").textContent = r || "");
  const fz = [...S.eqs.values()].filter(e => e.status === "faltando").length; const ne = $("n-maquinas"); if (ne) { ne.textContent = fz || ""; ne.classList.add("red"); }
  if (["fila", "responder", "processos", "arquivo", "maquinas", "pagamentos"].includes(S.tab)) preencher();
}
function badgeAvisos() { const n = [...S.avisos.values()].filter(a => !a.lido).length; const el = $("n-avisos"); if (el) { el.textContent = n; el.hidden = !n; } }
function badgeAjustes() { const n = S.usuarios.filter(u => u.status === "pendente").length; const el = $("n-ajustes"); if (el) { el.textContent = n || ""; el.classList.add("red"); } }
function preencher() { ({ fila: pFila, responder: pResponder, processos: pProcessos, arquivo: pArquivo, maquinas: pMaquinas, pagamentos: pPagamentos }[S.tab] || (() => { }))(); }

/* ------------------------------------------------------------------ cartões de processo */
function since(p) { let l = p.reenviadoEm || p.envio || ""; (p.etapas || []).forEach(e => { if (e.status === "ok" && e.em && e.em > l) l = e.em; }); return l; }
function idle(p) { const d = parse(since(p)); if (!d) return { h: 0, txt: "", sev: "fresh" }; const h = (Date.now() - d) / 36e5, dd = h / 24; return { h, txt: h < 1 ? "agora" : h < 24 ? Math.round(h) + " h" : Math.floor(dd) + " d", sev: dd >= 5 ? "red" : dd >= 1 ? "amber" : "fresh" }; }
function comQuem(p) { if (p.status === "devolvido") return "Devolvido — com " + (p.dono === S.user.uid ? "você" : p.por || "solicitante"); if (p.status === "conferir") return "Conferir"; const e = (p.etapas || []).find(e => e.status === "pendente"); return e ? "Com " + e.quem : ""; }
function etapas(p) { const et = p.etapas || []; return p.direto ? et.filter((e, i) => i === 0 || e.status === "ok") : et; }
function flow(p) {
  let seen = false;
  return `<div class="flow">${etapas(p).map(e => { let st = e.status || "vazio"; if (st === "pendente") { if (seen) st = "vazio"; seen = true; } const done = st === "ok"; const when = done && e.em ? fmtS(e.em) : st === "pendente" ? "aguardando" : st === "devolvido" ? "devolveu " + (e.em ? fmtS(e.em) : "") : ETL[st] || "—"; return `<div class="step ${done ? "done" : ""}"><i class="lamp ${st}"></i><span class="who">${esc(e.quem)}</span><span class="when">${esc(when)}</span></div>`; }).join("")}</div>`;
}
const metaLinha = p => [obraNome(p.obra), p.tipo, p.por ? "por " + p.por : ""].filter(Boolean).map(esc).join(" · ");
const ultimaDevolucao = p => { const h = (p.historico || []).filter(x => x.tipo === "devolucao").pop(); return h ? `${h.quem}: “${h.texto}”` : ""; };
function cartaoFila(p) {
  const i = idle(p), dev = p.status === "devolvido" || p.status === "conferir";
  return `<button class="item ${dev ? p.status : "sev-" + i.sev}" data-p="${esc(p.id)}">
    <div style="min-width:0"><h3>${esc(p.assunto)}</h3><div class="meta">${metaLinha(p)}</div></div>
    <div class="right"><span class="age c-${dev ? "amber" : i.sev}">${esc(i.txt)}<small>${dev ? "com você" : "parado"}</small></span></div>
    ${dev && ultimaDevolucao(p) ? `<div class="full say">${esc(ultimaDevolucao(p))}</div>` : ""}
    <div class="full"><span class="chip st-${esc(p.status)}">${esc(comQuem(p))}</span>${p.valor ? ` <span class="chip" style="font-family:var(--mono)">${esc(p.valor)}</span>` : ""}</div>
    <div class="full">${flow(p)}</div></button>`;
}
function cartaoProc(p) {
  return `<button class="item ${esc(p.status)}" data-p="${esc(p.id)}">
    <div style="min-width:0"><h3>${esc(p.assunto)}</h3><div class="meta">${metaLinha(p)}${p.obs?.length ? ` · ● ${p.obs.length} nota${p.obs.length > 1 ? "s" : ""}` : ""}</div></div>
    <div class="right"><span class="chip st-${esc(p.status)}">${esc(STL[p.status] || p.status)}</span>${p.valor ? `<span class="val">${esc(p.valor)}</span>` : ""}<span class="meta" style="font-family:var(--mono);font-size:11.5px">${p.aprovadoEm ? esc(fmtS(p.aprovadoEm)) : "desde " + esc(fmtS(since(p)))}</span></div>
    <div class="full">${flow(p)}</div></button>`;
}
function ligarCartoes(root) { root.querySelectorAll("[data-p]").forEach(b => b.onclick = () => abrirProc(b.dataset.p)); root.querySelectorAll("[data-r]").forEach(b => b.onclick = () => abrirResp(b.dataset.r)); }

/* ------------------------------------------------------------------ NA FILA */
function vFila() {
  $("main").innerHTML = `<div class="stats" id="stats"></div>
    <section class="list" id="sec-voce"><div class="sechead"><h2>Precisa de você</h2><span class="hint">devolvidos e para conferir</span></div><div class="grid2" id="voce"></div></section>
    <section class="list"><div class="sechead"><h2>Parados com aprovadores</h2><span class="hint">vermelho ≥ 5 dias · âmbar ≥ 1 dia</span></div><div class="grid2" id="parados"></div></section>
    <section class="list" id="sec-resp"></section>`;
  pFila();
}
function pFila() {
  const P = [...S.procs.values()], hoje = new Date().toDateString(), mes = agoraIso().slice(0, 7);
  const voce = P.filter(p => ["devolvido", "conferir"].includes(p.status)).sort((a, b) => (a.atualizadoEm || "").localeCompare(b.atualizadoEm || ""));
  const parados = P.filter(p => p.status === "pendente").sort((a, b) => idle(b).h - idle(a).h);
  const aprovHoje = P.filter(p => p.status === "aprovado" && p.aprovadoEm && parse(p.aprovadoEm).toDateString() === hoje).length;
  const aprovMes = P.filter(p => p.status === "aprovado" && (p.aprovadoEm || "").startsWith(mes)).length;
  const velhos = parados.filter(p => idle(p).sev === "red").length;
  const st = [["pendente", "Pendentes", parados.length, velhos ? velhos + " há 5 dias ou mais" : "aguardando aprovação", "var(--accent)"],
    ["devolvido", "Devolvidos", voce.length, "precisam de você", "var(--warn)"],
    ["aprovado", "Aprovados hoje", aprovHoje, "até agora", "var(--ok)"],
    ["aprovado", "No mês", aprovMes, new Date().toLocaleDateString("pt-BR", { month: "long" }), "var(--ok)"]];
  $("stats").innerHTML = st.map(s => `<button class="stat" data-f="${s[0]}"><span class="k"><i class="dot" style="background:${s[4]}"></i>${s[1]}</span><span class="v">${s[2]}</span><span class="s">${esc(s[3])}</span></button>`).join("");
  $("stats").querySelectorAll(".stat").forEach(b => b.onclick = () => { S.f.status = b.dataset.f; mostrar("processos"); });
  $("sec-voce").hidden = !voce.length;
  $("voce").innerHTML = voce.map(cartaoFila).join("");
  $("parados").innerHTML = parados.length ? parados.map(cartaoFila).join("") : `<div class="empty" style="grid-column:1/-1">${S.procs.size ? "Nada parado. Tudo o que foi enviado já tem aprovação." : "Nenhum processo ainda. Conecte seu e-mail em Minha conta."}</div>`;
  const resp = [...S.resps.values()].filter(r => r.status === "aguardando").sort((a, b) => (a.recebidoEm || "").localeCompare(b.recebidoEm || ""));
  $("sec-resp").innerHTML = resp.length ? `<div class="sechead"><h2>Aguardando sua resposta</h2><button class="link" id="ver-resp">ver todos (${resp.length})</button></div><div class="grid2">${resp.slice(0, 4).map(cartaoResp).join("")}</div>` : "";
  $("ver-resp") && ($("ver-resp").onclick = () => mostrar("responder"));
  ligarCartoes($("main"));
}

/* ------------------------------------------------------------------ A RESPONDER */
function idadeResp(r) { const d = parse(r.recebidoEm); const h = d ? (Date.now() - d) / 36e5 : 0; return { txt: h < 1 ? "agora" : h < 24 ? Math.round(h) + " h" : Math.floor(h / 24) + " d", sev: h >= 72 ? "red" : h >= 24 ? "amber" : "fresh" }; }
function cartaoResp(r) {
  const i = idadeResp(r), ag = r.status === "aguardando";
  return `<button class="item ${ag ? "sev-" + i.sev : ""}" data-r="${esc(r.id)}">
    <div style="min-width:0"><h3>${esc(r.assunto)}</h3><div class="meta">${esc(r.deNome || r.de)}${r.obra ? " · " + esc(obraNome(r.obra)) : ""} · ${esc(fmt(r.recebidoEm))}</div></div>
    <div class="right">${ag ? `<span class="age c-${i.sev}">${esc(i.txt)}<small>esperando</small></span>` : `<span class="chip st-${esc(r.status)}">${esc(RSL[r.status])}</span>`}</div>
    ${r.trecho ? `<div class="full meta">“${esc(r.trecho)}”</div>` : ""}</button>`;
}
function vResponder() {
  const rem = [...new Set([...S.resps.values()].map(r => r.deNome || r.de))].sort();
  $("main").innerHTML = `<div class="card"><div class="filters" style="grid-template-columns:2fr 1fr 1fr">
      <input id="rq" class="wide" type="search" placeholder="Buscar assunto ou texto" value="${esc(S.f.rq || "")}">
      <select id="rs"><option value="aguardando">Aguardando você</option><option value="respondido">Respondidos</option><option value="resolvido">Resolvidos</option><option value="arquivado">Sem resposta necessária</option><option value="">Todos</option></select>
      <select id="rd"><option value="">Todas as pessoas</option>${rem.map(x => `<option>${esc(x)}</option>`).join("")}</select></div>
      <p class="hint" style="margin-top:8px">E-mails de ${esc((S.cfg.responder?.remetentes || []).join(", ") || "remetentes escolhidos em Ajustes")} ficam aqui até você responder.</p></div>
    <div class="list" id="rlist"></div>`;
  $("rs").value = S.f.rs ?? "aguardando"; $("rd").value = S.f.rd || "";
  ["rq", "rs", "rd"].forEach(id => $(id).oninput = () => { S.f[id] = $(id).value; pResponder(); });
  pResponder();
}
function pResponder() {
  if (!$("rlist")) return;
  const q = ($("rq").value || "").toLowerCase(), s = $("rs").value, d = $("rd").value;
  const L = [...S.resps.values()].filter(r => (!s || r.status === s) && (!d || (r.deNome || r.de) === d) && (!q || [r.assunto, r.trecho, r.deNome].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => s === "aguardando" ? (a.recebidoEm || "").localeCompare(b.recebidoEm || "") : (b.recebidoEm || "").localeCompare(a.recebidoEm || ""));
  $("rlist").innerHTML = L.length ? L.map(cartaoResp).join("") : `<div class="empty">Nada por aqui.</div>`;
  ligarCartoes($("rlist"));
}
function abrirResp(id, modo) {
  const r = S.resps.get(id); if (!r) return;
  const hist = (r.historico || []).map(h => `<li><i class="lamp ${h.tipo === "respondido" ? "ok" : h.tipo === "reaberto" ? "devolvido" : "envio"}"></i><span class="mono">${esc(fmt(h.em))}</span><span>${esc({ recebido: "Recebido", respondido: "Você respondeu", reaberto: "Nova mensagem", resolvido: "Resolvido no app", arquivado: "Marcado sem resposta" }[h.tipo] || h.tipo)}</span></li>`).join("");
  abrir(`<h3>${esc(r.assunto)}</h3><dl class="kv"><dt>Situação</dt><dd><span class="chip st-${esc(r.status)}">${esc(RSL[r.status])}</span></dd><dt>De</dt><dd>${esc(r.deNome)} &lt;${esc(r.de)}&gt;</dd><dt>Recebido</dt><dd>${esc(fmt(r.recebidoEm))}</dd>${r.respondidoEm ? `<dt>Respondido</dt><dd>${esc(fmt(r.respondidoEm))}</dd>` : ""}${r.motivo ? `<dt>Motivo</dt><dd>${esc(r.motivo)}</dd>` : ""}</dl>
    ${r.trecho ? `<blockquote class="quote" style="border-color:var(--warn)">“${esc(r.trecho)}”</blockquote>` : ""}<ol class="tl">${hist}</ol>
    ${modo === "resolver" ? `<form id="fr" style="display:grid;gap:8px"><label class="f">Como foi resolvido <span class="opt">(opcional)</span><textarea id="r-mot" placeholder="Ex.: respondi pelo WhatsApp"></textarea></label><div class="row"><button class="btn primary">Marcar como resolvido</button><button class="btn" type="button" id="r-x">Cancelar</button></div></form>`
      : `<div class="row">${r.status === "aguardando" ? `<button class="btn primary" id="r-res">Resolvido</button><button class="btn" id="r-arq">Não precisa responder</button>` : `<button class="btn" id="r-reab">Reabrir</button>`}<button class="btn" id="r-f">Fechar</button></div>`}`, B => {
    const upd = async (d, txt) => { try { await updateDoc(doc(db, "responder", id), { ...d, atualizadoEm: agoraIso() }); toast(txt); fechar(); } catch (e) { toast(erroMsg(e)); } };
    B.querySelector("#r-f") && (B.querySelector("#r-f").onclick = fechar);
    B.querySelector("#r-x") && (B.querySelector("#r-x").onclick = () => abrirResp(id));
    B.querySelector("#r-res") && (B.querySelector("#r-res").onclick = () => abrirResp(id, "resolver"));
    B.querySelector("#r-arq") && (B.querySelector("#r-arq").onclick = () => upd({ status: "arquivado", resolvidoEm: agoraIso(), motivo: "Não precisa responder" }, "Marcado como sem resposta"));
    B.querySelector("#r-reab") && (B.querySelector("#r-reab").onclick = () => upd({ status: "aguardando", motivo: "" }, "Reaberto"));
    B.querySelector("#fr") && (B.querySelector("#fr").onsubmit = e => { e.preventDefault(); upd({ status: "resolvido", resolvidoEm: agoraIso(), motivo: B.querySelector("#r-mot").value.trim() || "Resolvido fora do e-mail" }, "Resolvido"); });
  });
}

/* ------------------------------------------------------------------ PROCESSOS */
function opcoesObras(sel, vazio = "Todas obras") { return `<option value="">${vazio}</option>` + S.obras.map(o => `<option value="${esc(o.codigo)}"${o.codigo === sel ? " selected" : ""}>${esc(obraNome(o.codigo))}${o.ativa === false ? " (encerrada)" : ""}</option>`).join("") + (sel === "SEM_OBRA" ? `<option value="SEM_OBRA" selected>Obra não identificada</option>` : ""); }
function vProcessos() {
  const tipos = [...new Set([...S.procs.values()].map(p => p.tipo).filter(Boolean))].sort();
  $("main").innerHTML = `<div class="card"><div class="filters">
      <input id="q" class="wide" type="search" placeholder="Buscar assunto, fornecedor, OC, BM…" value="${esc(S.f.q || "")}">
      <select id="fs"><option value="">Todas situações</option><option value="pendente">Pendentes</option><option value="devolvido">Devolvidos</option><option value="conferir">Conferir</option><option value="aprovado">Aprovados</option><option value="encerrado">Encerrados</option></select>
      <select id="fo">${opcoesObras(S.f.fo)}${[...S.procs.values()].some(p => p.obra === "SEM_OBRA") && S.f.fo !== "SEM_OBRA" ? `<option value="SEM_OBRA">Obra não identificada</option>` : ""}</select>
      <select id="ft"><option value="">Todos tipos</option>${tipos.map(t => `<option${t === S.f.ft ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      <div class="sum"><span id="sum"></span><label class="check"><input type="checkbox" id="fm"${S.f.fm ? " checked" : ""}> Só os meus</label></div></div>
    <div class="list" id="ledger"></div>
    <div class="legend"><span><i class="lamp ok"></i>Aprovou</span><span><i class="lamp pendente"></i>Aguardando</span><span><i class="lamp devolvido"></i>Devolveu</span><span><i class="lamp folga"></i>Folga / ausente</span></div>`;
  $("fs").value = S.f.status ?? S.f.fs ?? ""; S.f.fs = $("fs").value; delete S.f.status;
  const sync = () => { S.f.q = $("q").value; S.f.fs = $("fs").value; S.f.fo = $("fo").value; S.f.ft = $("ft").value; S.f.fm = $("fm").checked; pProcessos(); };
  ["q", "fs", "fo", "ft", "fm"].forEach(id => $(id).oninput = sync);
  pProcessos();
}
function pProcessos() {
  if (!$("ledger")) return;
  const q = (S.f.q || "").toLowerCase(), s = S.f.fs, o = S.f.fo, t = S.f.ft, meus = S.f.fm;
  const L = [...S.procs.values()].filter(p => (!s || p.status === s) && (!o || p.obra === o) && (!t || p.tipo === t) && (!meus || p.dono === S.user.uid || (p.copias || []).includes(S.user.uid))
    && (!q || [p.assunto, p.obra, obraNome(p.obra), p.tipo, p.por, p.valor, (p.obs || []).join(" ")].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => ((b.aprovadoEm || since(b)) > (a.aprovadoEm || since(a)) ? 1 : -1));
  $("sum").textContent = `${L.length} de ${S.procs.size} processos`;
  if (!L.length) { $("ledger").innerHTML = `<div class="empty">${S.procs.size ? "Nenhum processo com esses filtros." : "Nenhum processo ainda."}</div>`; return; }
  let h = "", cur = null;
  L.slice(0, 400).forEach(p => { const k = dayKey(p.aprovadoEm || since(p)); if (k !== cur) { cur = k; h += `<div class="day"><span>${esc(dayLabel(k))}</span><span>${L.filter(x => dayKey(x.aprovadoEm || since(x)) === k).length}</span></div>`; } h += cartaoProc(p); });
  if (L.length > 400) h += `<p class="hint">Mostrando 400 de ${L.length}. Use os filtros para ver os outros.</p>`;
  $("ledger").innerHTML = h; ligarCartoes($("ledger"));
}
function podeEncerrar(p) { return isAdmin() || S.perfil.podeEncerrar; }
function abrirProc(id, modo) {
  const p = S.procs.get(id); if (!p) return;
  const tl = [`<li><i class="lamp envio"></i><span class="mono">${esc(fmt(p.envio))}</span><span>Enviado por <b>${esc(p.por)}</b></span></li>`];
  (p.historico || []).forEach(h => { if (h.tipo === "devolucao") tl.push(`<li><i class="lamp devolvido"></i><span class="mono">${esc(fmt(h.em))}</span><span><b>${esc(h.quem)}</b> · Devolveu<span class="q">“${esc(h.texto)}”</span></span></li>`); if (h.tipo === "reenvio") tl.push(`<li><i class="lamp reenvio"></i><span class="mono">${esc(fmt(h.em))}</span><span>Reenviado por <b>${esc(p.por)}</b></span></li>`); });
  etapas(p).forEach(e => { if (e.status === "devolvido") return; tl.push(`<li><i class="lamp ${esc(e.status || "vazio")}"></i><span class="mono">${e.em ? esc(fmt(e.em)) : "—"}</span><span><b>${esc(e.quem)}</b> · ${esc(ETL[e.status] || "sem registro")}</span></li>`); });
  const kv = [["Situação", `<span class="chip st-${esc(p.status)}">${esc(STL[p.status] || p.status)}</span>`], ["Obra", esc(obraNome(p.obra))], ["Tipo", esc(p.tipo)], ["Valor", p.valor ? `<span style="font-family:var(--mono)">${esc(p.valor)}</span>` : ""], ["Solicitante", esc(p.por)], ["Enviado", esc(fmt(p.envio))], ["Aprovado em", p.aprovadoEm ? esc(fmt(p.aprovadoEm)) : ""], ["Parado", ["pendente", "devolvido", "conferir"].includes(p.status) ? esc(idle(p).txt + " · " + comQuem(p)) : ""]].filter(x => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  let acoes;
  if (modo === "encerrar") acoes = `<form id="fe" style="display:grid;gap:8px"><label class="f">Motivo do encerramento <span class="opt">(fica gravado)</span><textarea id="e-mot" required placeholder="Ex.: aprovado por WhatsApp pelo Dr. Ubirajara"></textarea></label><div class="row"><button class="btn primary">Encerrar processo</button><button class="btn" type="button" id="e-x">Cancelar</button></div></form>`;
  else acoes = `<div class="row">${p.pdf ? `<button class="btn" id="b-pdf">Abrir comprovante PDF</button>` : ""}${podeEncerrar(p) ? (p.status === "encerrado" ? `<button class="btn" id="b-reab">Reabrir</button>` : p.status !== "aprovado" ? `<button class="btn danger" id="b-enc">Encerrar manualmente</button>` : "") : ""}<button class="btn primary" id="b-x">Fechar</button></div>
    ${isAdmin() ? `<details><summary class="hint" style="cursor:pointer">Administrador</summary><div class="row" style="margin-top:8px"><select id="b-obra" style="max-width:260px">${opcoesObras(p.obra, "Escolha a obra")}</select><button class="btn sm" id="b-obra-s">Salvar obra</button><button class="btn sm danger" id="b-del">Excluir processo</button></div></details>` : ""}`;
  abrir(`<h3>${esc(p.assunto)}</h3><dl class="kv">${kv}</dl><ol class="tl">${tl.join("")}</ol>
    ${p.status === "aprovado" && p.aprovacao ? `<blockquote class="quote">“${esc(p.aprovacao)}”<br><span class="hint">— ${esc(p.aprovadoPor === "UICF" || !p.aprovadoPor ? "Ubirajara Filho (UICF)" : p.aprovadoPor)}</span></blockquote>` : ""}
    ${p.encerramento ? `<p class="hint">Encerrado em ${esc(fmt(p.encerramento.em))}: ${esc(p.encerramento.motivo)}</p>` : ""}
    ${p.obs?.length ? `<ul class="obs">${p.obs.map(o => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}${acoes}`, B => {
    const on = (sel, fn) => { const el = B.querySelector(sel); el && (el.onclick = fn); };
    on("#b-x", fechar); on("#e-x", () => abrirProc(id));
    on("#b-pdf", () => abrirPdf(id));
    on("#b-enc", () => { abrirProc(id, "encerrar"); setTimeout(() => B.querySelector("#e-mot")?.focus(), 0); });
    on("#b-reab", async () => { try { await updateDoc(doc(db, "processos", id), { status: p.encerramento?.antes || "pendente", encerramento: null, atualizadoEm: agoraIso() }); toast("Processo reaberto"); fechar(); } catch (e) { toast(erroMsg(e)); } });
    on("#b-obra-s", async () => { const v = B.querySelector("#b-obra").value; if (!v) return; try { await updateDoc(doc(db, "processos", id), { obra: v, obs: (p.obs || []).filter(o => !o.startsWith("Obra não identificada")) }); registrar("Obra corrigida", id, v); toast("Obra salva"); fechar(); } catch (e) { toast(erroMsg(e)); } });
    on("#b-del", async () => { const b = B.querySelector("#b-del"); if (b.dataset.c !== "1") { b.dataset.c = "1"; b.textContent = "Confirmar exclusão"; return; } try { await deleteDoc(doc(db, "processos", id)); registrar("Processo excluído", id, p.assunto); toast("Excluído"); fechar(); } catch (e) { toast(erroMsg(e)); } });
    const f = B.querySelector("#fe"); f && (f.onsubmit = async e => { e.preventDefault(); const motivo = B.querySelector("#e-mot").value.trim(); if (!motivo) return; try { await updateDoc(doc(db, "processos", id), { status: "encerrado", encerramento: { motivo, em: agoraIso(), antes: p.status, por: S.perfil.nome }, atualizadoEm: agoraIso() }); toast("Processo encerrado"); fechar(); } catch (err) { toast(erroMsg(err)); } });
  });
}
async function abrirPdf(id) {
  const w = window.open("", "_blank");
  try {
    const s = await getDoc(doc(db, "processos", id, "arquivo", "pdf"));
    if (!s.exists()) { w && w.close(); return toast("PDF ainda não gerado."); }
    const d = s.data(), bin = atob(d.base64), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
    if (w) w.location = url; else { const a = document.createElement("a"); a.href = url; a.download = d.nome || "comprovante.pdf"; a.click(); }
  } catch (e) { w && w.close(); toast(erroMsg(e)); }
}

/* ------------------------------------------------------------------ ARQUIVO */
function vArquivo() {
  $("main").innerHTML = `<div class="card"><div class="filters" style="grid-template-columns:2fr 1fr"><input id="aq" type="search" placeholder="Buscar comprovante" value="${esc(S.f.aq || "")}"><select id="ao">${opcoesObras(S.f.ao)}</select></div>
    <p class="hint" style="margin-top:8px">Um PDF por aprovação: pedido, linha do tempo e texto da aprovação.</p></div><div class="list" id="folders"></div>`;
  ["aq", "ao"].forEach(id => $(id).oninput = () => { S.f[id] = $(id).value; pArquivo(); });
  pArquivo();
}
function pArquivo() {
  if (!$("folders")) return;
  const q = (S.f.aq || "").toLowerCase(), o = S.f.ao;
  const L = [...S.procs.values()].filter(p => p.pdf && (!o || p.obra === o) && (!q || (p.assunto + " " + (p.pdf.nome || "")).toLowerCase().includes(q)));
  const pastas = [...new Set(L.map(p => p.obra))].sort((a, b) => String(a).localeCompare(String(b), "pt", { numeric: true }));
  $("folders").innerHTML = L.length ? pastas.map(k => { const fs = L.filter(p => p.obra === k).sort((a, b) => (b.aprovadoEm || "").localeCompare(a.aprovadoEm || ""));
    return `<section class="list"><div class="sechead"><h2>${esc(obraNome(k))}</h2><span class="hint">${fs.length} PDF${fs.length > 1 ? "s" : ""}</span></div><div class="grid2">${fs.map(p => `<button class="file" data-pdf="${esc(p.id)}"><span class="ico">PDF</span><span><b>${esc(p.assunto)}</b><small>aprovado ${esc(fmt(p.aprovadoEm))}${p.valor ? " · " + esc(p.valor) : ""}</small></span></button>`).join("")}</div></section>`; }).join("")
    : `<div class="empty">Os comprovantes aparecem aqui conforme as aprovações chegam.</div>`;
  $("folders").querySelectorAll("[data-pdf]").forEach(b => b.onclick = () => abrirPdf(b.dataset.pdf));
}

/* ------------------------------------------------------------------ MÁQUINAS */
function vMaquinas() {
  $("main").innerHTML = `<div class="card"><div class="filters" style="grid-template-columns:1fr 1fr${isAdmin() ? " auto" : ""}"><select id="mo">${opcoesObras(S.f.mo)}</select>
    <select id="ms"><option value="">Todas situações</option>${Object.entries(EQL).map(([k, v]) => `<option value="${k}"${S.f.ms === k ? " selected" : ""}>${v}</option>`).join("")}</select>
    ${isAdmin() ? `<button class="btn" id="m-nova">+ Máquina</button>` : ""}</div><div class="sum" id="msum"></div></div><div class="list" id="eq"></div>`;
  ["mo", "ms"].forEach(id => $(id).oninput = () => { S.f[id] = $(id).value; pMaquinas(); });
  $("m-nova") && ($("m-nova").onclick = () => editarMaquina(null));
  pMaquinas();
}
function pMaquinas() {
  if (!$("eq")) return;
  const E = [...S.eqs.values()], L = E.filter(e => (!S.f.mo || e.obra === S.f.mo) && (!S.f.ms || e.status === S.f.ms));
  const cnt = {}; E.forEach(e => cnt[e.status] = (cnt[e.status] || 0) + 1);
  $("msum").innerHTML = Object.keys(EQL).filter(k => cnt[k]).map(k => `<span class="chip st-${k}">${EQL[k]} ${cnt[k]}</span>`).join("");
  const rank = { faltando: 0, pendente: 1, confirmar: 2, em_dia: 3, avulso: 4, encerrado: 5 };
  const obras = [...new Set(L.map(e => e.obra))].sort();
  $("eq").innerHTML = L.length ? obras.map(o => `<section class="list"><h2>${esc(obraNome(o))}</h2><div class="grid2">${L.filter(e => e.obra === o).sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9)).map(e => { const u = e.ultimo || {}, n = e.proximo || {};
    return `<div class="mach ${esc(e.status)}" ${isAdmin() ? `data-m="${esc(e.id)}" style="cursor:pointer"` : ""}><div class="top"><div style="min-width:0"><h3>${esc(e.maquina)}</h3><div class="meta">${esc([e.fornecedor, e.local, e.periodicidade].filter(Boolean).join(" · "))}</div></div><span class="chip st-${esc(e.status)}">${esc(EQL[e.status] || e.status)}</span></div>
      <div class="bm"><div><span class="l">Último</span>${u.bm ? `<b>${esc(u.bm)}</b><span class="p">${esc(u.periodo || "")}</span>${u.aprovadoEm ? `<br><span class="p">aprov. ${esc(fmt(u.aprovadoEm))}</span>` : ""}` : "<b>—</b>"}</div>
      <div><span class="l">Próximo</span>${n.bm ? `<b>${esc(n.bm)}</b><span class="p">${esc(n.periodo || "")}</span>${n.fim ? `<br><span class="p">fecha ${esc(n.fim)}</span>` : ""}` : "<b>—</b>"}</div></div>
      ${e.obs?.length ? `<ul>${e.obs.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`; }).join("")}</div></section>`).join("")
    : `<div class="empty">${E.length ? "Nenhuma máquina com esses filtros." : "As máquinas aparecem aqui quando houver BM aprovado ou cadastro."}</div>`;
  $("eq").querySelectorAll("[data-m]").forEach(el => el.onclick = () => editarMaquina(el.dataset.m));
}
function editarMaquina(id) {
  const e = id ? S.eqs.get(id) : { status: "em_dia", periodicidade: "Mensal", obs: [], aliases: [], ultimo: {}, proximo: {} };
  abrir(`<h3>${id ? "Editar máquina" : "Nova máquina"}</h3><form id="fm2" style="display:grid;gap:10px"><div class="grid2f">
    <label class="f">Máquina<input id="m-maq" value="${esc(e.maquina)}" required></label><label class="f">Fornecedor<input id="m-forn" value="${esc(e.fornecedor)}"></label>
    <label class="f">Local<input id="m-loc" value="${esc(e.local)}"></label><label class="f">Obra<select id="m-obra">${opcoesObras(e.obra, "Escolha")}</select></label>
    <label class="f">Periodicidade<select id="m-per">${["Quinzenal", "Mensal", "Diária"].map(x => `<option${x === e.periodicidade ? " selected" : ""}>${x}</option>`).join("")}</select></label>
    <label class="f">Situação<select id="m-st">${Object.entries(EQL).map(([k, v]) => `<option value="${k}"${k === e.status ? " selected" : ""}>${v}</option>`).join("")}</select></label>
    <label class="f">Próximo BM<input id="m-pbm" value="${esc(e.proximo?.bm)}" placeholder="BM 04"></label><label class="f">Fecha em<input id="m-pfim" value="${esc(e.proximo?.fim)}" placeholder="30/11/2026"></label></div>
    <label class="f">Palavras para o robô reconhecer o BM <span class="opt">(separe por vírgula: fornecedor, modelo, local)</span><input id="m-al" value="${esc((e.aliases || []).join(", "))}"></label>
    <label class="f">Observações <span class="opt">(uma por linha)</span><textarea id="m-obs">${esc((e.obs || []).join("\n"))}</textarea></label>
    <div class="row"><button class="btn primary">Salvar</button><button class="btn" type="button" id="m-x">Cancelar</button>${id ? `<button class="btn danger" type="button" id="m-del">Excluir</button>` : ""}</div></form>`, B => {
    B.querySelector("#m-x").onclick = fechar;
    B.querySelector("#m-del") && (B.querySelector("#m-del").onclick = async ev => { const b = ev.target; if (b.dataset.c !== "1") { b.dataset.c = "1"; b.textContent = "Confirmar exclusão"; return; } await deleteDoc(doc(db, "equipamentos", id)); registrar("Máquina excluída", id, e.maquina); fechar(); });
    B.querySelector("#fm2").onsubmit = async ev => { ev.preventDefault(); const v = s => B.querySelector(s).value.trim();
      const d = { maquina: v("#m-maq"), fornecedor: v("#m-forn"), local: v("#m-loc"), obra: v("#m-obra"), periodicidade: v("#m-per"), status: v("#m-st"), aliases: v("#m-al").split(",").map(x => x.trim()).filter(Boolean), obs: v("#m-obs").split("\n").map(x => x.trim()).filter(Boolean), proximo: { ...(e.proximo || {}), bm: v("#m-pbm"), fim: v("#m-pfim") }, atualizadoEm: agoraIso() };
      if (!d.maquina || !d.obra) return toast("Preencha máquina e obra.");
      try { if (id) await updateDoc(doc(db, "equipamentos", id), d); else await addDoc(collection(db, "equipamentos"), { ...d, ultimo: {} }); registrar(id ? "Máquina editada" : "Máquina criada", id || d.maquina, d.maquina); toast("Salvo"); fechar(); } catch (err) { toast(erroMsg(err)); } };
  });
}

/* ------------------------------------------------------------------ PAGAMENTOS */
function vPagamentos() {
  const meses = [...new Set([...S.procs.values()].map(p => (p.aprovadoEm || p.envio || "").slice(0, 7)).filter(Boolean))].sort().reverse();
  const atual = S.f.pm || agoraIso().slice(0, 7); if (!meses.includes(atual)) meses.unshift(atual);
  $("main").innerHTML = `<div class="card"><div class="filters" style="grid-template-columns:1fr 1fr"><select id="pm">${meses.map(m => `<option value="${m}"${m === atual ? " selected" : ""}>${new Date(m + "-15").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</option>`).join("")}</select><select id="po">${opcoesObras(S.f.po)}</select></div>
    <p class="hint" style="margin-top:8px">Somam só os pedidos com valor informado no e-mail.</p></div><div class="stats" id="pst"></div><div class="card" id="ptab"></div><section class="list" id="preemb"></section>`;
  ["pm", "po"].forEach(id => $(id).oninput = () => { S.f[id] = $(id).value; pPagamentos(); });
  pPagamentos();
}
function pPagamentos() {
  if (!$("pst")) return;
  const m = $("pm").value, o = $("po").value, P = [...S.procs.values()].filter(p => !o || p.obra === o);
  const apr = P.filter(p => p.status === "aprovado" && (p.aprovadoEm || "").startsWith(m)), pen = P.filter(p => ["pendente", "devolvido", "conferir"].includes(p.status));
  const sa = apr.reduce((s, p) => s + money(p.valor), 0), sp = pen.reduce((s, p) => s + money(p.valor), 0);
  $("pst").innerHTML = [["Aprovado no mês", brl(sa), apr.length + " pedidos", "var(--ok)"], ["Pendente agora", brl(sp), pen.length + " pedidos", "var(--accent)"]].map(s => `<div class="stat"><span class="k"><i class="dot" style="background:${s[3]}"></i>${s[0]}</span><span class="v" style="font-size:20px">${s[1]}</span><span class="s">${s[2]}</span></div>`).join("");
  const obras = [...new Set([...apr, ...pen].map(p => p.obra))].sort();
  $("ptab").innerHTML = obras.length ? `<table class="tbl"><thead><tr><th>Obra</th><th class="r">Aprovado</th><th class="r">Pendente</th></tr></thead><tbody>${obras.map(k => `<tr><td>${esc(obraNome(k))}</td><td class="r">${brl(apr.filter(p => p.obra === k).reduce((s, p) => s + money(p.valor), 0))}</td><td class="r">${brl(pen.filter(p => p.obra === k).reduce((s, p) => s + money(p.valor), 0))}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">Sem valores neste mês.</div>`;
  const re = pen.map(p => { const mm = /reembolso\s*(?:em|previsto|para)?\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(p.assunto || ""); return mm ? { p, d: `${mm[3]}-${mm[2]}-${mm[1]}` } : null; }).filter(Boolean).sort((a, b) => a.d.localeCompare(b.d));
  $("preemb").innerHTML = re.length ? `<div class="sechead"><h2>Reembolsos previstos</h2><span class="hint">ainda não aprovados</span></div><div class="grid2">${re.map(x => cartaoFila(x.p)).join("")}</div>` : "";
  ligarCartoes($("preemb"));
}

/* ------------------------------------------------------------------ MINHA CONTA */
async function cifrar(texto) {
  const pem = S.robo?.publicKey; if (!pem) throw { message: "O robô ainda não rodou pela primeira vez. Tente de novo em alguns minutos." };
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("spki", raw, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(texto)));
  let s = ""; ct.forEach(b => s += String.fromCharCode(b)); return btoa(s);
}
function vConta() {
  const p = S.perfil, c = S.conta;
  const perm = [p.papel === "admin" ? "Administrador" : p.papel === "leitura" ? "Só leitura" : "Usuário", p.ver?.tudo ? "vê todas as obras" : [p.ver?.proprios ? "os próprios fluxos" : "", (p.ver?.obras || []).length ? "obras " + p.ver.obras.join(", ") : ""].filter(Boolean).join(" + ") || "sem obras liberadas", p.rh ? "vê RH" : "sem RH"].join(" · ");
  $("main").innerHTML = `<div class="card"><h2>${esc(p.nome)}</h2><p class="hint">Matrícula ${esc(p.matricula)} · ${esc(perm)}</p></div>
    <div class="card" style="display:grid;gap:10px"><h2>E-mail LocaWeb</h2>
    ${!p.podeConectar ? `<p class="hint">O administrador ainda não liberou a conexão do seu e-mail.</p>` : c ? `
      <dl class="kv"><dt>Conta</dt><dd>${esc(c.emailLocaweb)}</dd><dt>Situação</dt><dd><span class="chip st-${c.estado === "erro" ? "erro" : "ativo"}">${c.estado === "erro" ? "Com erro" : c.ultimaLeitura ? "Conectado" : "Aguardando a primeira leitura"}</span></dd>${c.ultimaLeitura ? `<dt>Última leitura</dt><dd>${esc(fmt(c.ultimaLeitura))}</dd>` : ""}${c.erro ? `<dt>Erro</dt><dd>${esc(c.erro)}</dd>` : ""}<dt>Pedidos em cópia</dt><dd>${c.incluirCopia === false ? "Não incluir" : "Incluir"}</dd></dl>
      <div class="row"><button class="btn" id="c-rec">Reconectar / trocar senha</button><button class="btn danger" id="c-des">Desconectar</button></div>` : `<p class="hint">Conecte para o robô acompanhar os fluxos que saem do seu e-mail. Ele só lê: não envia, não apaga e não marca nada como lido.</p><button class="btn primary" id="c-con">Conectar meu e-mail</button>`}
    </div>
    <div class="card" style="display:grid;gap:10px"><h2>Senha do app</h2><form id="fs2" class="grid2f"><label class="f">Senha atual<input id="s-at" type="password" autocomplete="current-password"></label><label class="f">Nova senha<input id="s-nv" type="password" autocomplete="new-password" minlength="6"></label><div class="row"><button class="btn">Trocar senha</button></div></form></div>
    <div class="row"><button class="btn" id="c-sair">Sair do app</button></div>`;
  const conectar = () => abrir(`<h3>Conectar e-mail LocaWeb</h3><p class="hint">A senha é trancada aqui mesmo, no seu aparelho, com a chave do robô. Depois disso ninguém consegue lê-la pelo app ou pelo banco.</p>
    <form id="fc" style="display:grid;gap:10px"><label class="f">E-mail<input id="c-em" type="email" value="${esc(c?.emailLocaweb || p.emailContato || "")}" required></label><label class="f">Senha do e-mail<input id="c-se" type="password" autocomplete="off" required></label>
    <label class="check"><input type="checkbox" id="c-cp"${c?.incluirCopia === false ? "" : " checked"}> Incluir pedidos de outras pessoas em que estou em cópia</label>
    <div id="c-msg" class="alert bad" hidden></div><div class="row"><button class="btn primary">Conectar</button><button class="btn" type="button" id="c-x">Cancelar</button></div></form>`, B => {
    B.querySelector("#c-x").onclick = fechar;
    B.querySelector("#fc").onsubmit = async e => { e.preventDefault(); const btn = e.submitter; btn.disabled = true;
      try { const senha = B.querySelector("#c-se").value; const cif = await cifrar(senha); B.querySelector("#c-se").value = "";
        await setDoc(doc(db, "contas", S.user.uid), { emailLocaweb: B.querySelector("#c-em").value.trim().toLowerCase(), senhaCifrada: cif, conectadoEm: agoraIso(), incluirCopia: B.querySelector("#c-cp").checked, estado: "aguardando" }, { merge: true });
        toast("Conectado. O robô lê seu e-mail na próxima rodada (até 10 min)."); fechar();
      } catch (err) { const m = B.querySelector("#c-msg"); m.textContent = erroMsg(err); m.hidden = false; } finally { btn.disabled = false; } };
  });
  $("c-con") && ($("c-con").onclick = conectar); $("c-rec") && ($("c-rec").onclick = conectar);
  $("c-des") && ($("c-des").onclick = async ev => { const b = ev.target; if (b.dataset.c !== "1") { b.dataset.c = "1"; b.textContent = "Confirmar: apagar senha guardada"; return; } await deleteDoc(doc(db, "contas", S.user.uid)); toast("E-mail desconectado e senha apagada."); });
  $("fs2").onsubmit = async e => { e.preventDefault(); try { await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, $("s-at").value)); await updatePassword(auth.currentUser, $("s-nv").value); toast("Senha alterada."); $("fs2").reset(); } catch (err) { toast(erroMsg(err)); } };
  $("c-sair").onclick = () => signOut(auth);
}

/* ------------------------------------------------------------------ AVISOS */
function abrirAvisos() {
  const L = [...S.avisos.values()].sort((a, b) => String(b.em || "").localeCompare(String(a.em || "")));
  abrir(`<div class="sechead"><h3>Avisos</h3><div class="row"><button class="btn sm" id="av-lidos">Marcar todos como lidos</button><button class="btn sm" id="av-limpar">Limpar lidos</button></div></div>
    <div>${L.length ? L.slice(0, 80).map(a => `<div class="aviso ${a.lido ? "" : "novo"}" data-a="${esc(a.id)}" style="cursor:pointer"><b>${esc(a.titulo)}</b><span class="meta">${esc(a.texto)}</span><span class="hint">${a.em ? esc(dm(new Date(a.em)) + " " + hm(new Date(a.em))) : ""}</span></div>`).join("") : `<div class="empty">Sem avisos.</div>`}</div>
    <div class="row"><button class="btn primary" id="av-x">Fechar</button></div>`, B => {
    B.querySelector("#av-x").onclick = fechar;
    B.querySelector("#av-lidos").onclick = async () => { const b = writeBatch(db); L.filter(a => !a.lido).forEach(a => b.update(doc(db, "avisos", a.id), { lido: true })); await b.commit(); fechar(); };
    B.querySelector("#av-limpar").onclick = async () => { const b = writeBatch(db); L.filter(a => a.lido).forEach(a => b.delete(doc(db, "avisos", a.id))); await b.commit(); fechar(); };
    B.querySelectorAll("[data-a]").forEach(el => el.onclick = async () => { const a = S.avisos.get(el.dataset.a); if (!a.lido) updateDoc(doc(db, "avisos", a.id), { lido: true }); fechar(); const r = a.ref || "";
      if (r.startsWith("p_") && S.procs.has(r)) abrirProc(r); else if (r.startsWith("r_") && S.resps.has(r)) abrirResp(r); else if (r === "conta") mostrar("conta"); else if (isAdmin() && S.usuarios.some(u => u.uid === r)) { S.sub = "usuarios"; mostrar("ajustes"); } });
  });
}

/* ------------------------------------------------------------------ AJUSTES (administrador) */
async function registrar(acao, alvo, detalhe) { try { await addDoc(collection(db, "log"), { acao, alvo: String(alvo || ""), detalhe: String(detalhe || "").slice(0, 300), por: S.user.uid, porNome: S.perfil.nome, em: agoraIso() }); } catch (e) { } }
const SUBS = [["usuarios", "Usuários"], ["obras", "Obras"], ["fluxo", "Fluxo de aprovação"], ["responder", "A responder"], ["robo", "Robô"], ["importar", "Importar histórico"], ["log", "Histórico de ações"]];
function vAjustes() {
  if (!isAdmin()) return mostrar("fila");
  $("main").innerHTML = `<div class="subtabs" id="subs">${SUBS.map(s => `<button data-s="${s[0]}" aria-pressed="${S.sub === s[0]}">${s[1]}</button>`).join("")}</div><div id="aj" class="list"></div>`;
  $("subs").querySelectorAll("button").forEach(b => b.onclick = () => { S.sub = b.dataset.s; vAjustes(); });
  preencherAjustes();
}
function preencherAjustes() {
  if (!$("aj")) return;
  ({ usuarios: ajUsuarios, obras: ajObras, fluxo: ajFluxo, responder: ajResponder, robo: ajRobo, importar: ajImportar, log: ajLog }[S.sub] || ajUsuarios)();
}
function resumoPerm(u) { if (u.papel === "admin") return "Administrador"; const v = u.ver || {}; return [u.papel === "leitura" ? "Só leitura" : "Usuário", v.tudo ? "todas as obras" : [v.proprios ? "próprios" : "", (v.obras || []).join(", ")].filter(Boolean).join(" + ") || "nada liberado", u.rh ? "RH" : ""].filter(Boolean).join(" · "); }
function ajUsuarios() {
  const pend = S.usuarios.filter(u => u.status === "pendente"), outros = S.usuarios.filter(u => u.status !== "pendente").sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  $("aj").innerHTML = `${pend.length ? `<section class="list"><h2>Pedidos de acesso</h2>${pend.map(u => `<div class="card row" style="justify-content:space-between"><div><b>${esc(u.nome)}</b><div class="meta">Matrícula ${esc(u.matricula)} · ${esc(u.emailContato || "sem e-mail")} · pediu em ${esc(fmt(u.criadoEm))}${u.obraPedido ? " · obra " + esc(u.obraPedido) : ""}</div></div><div class="row"><button class="btn primary sm" data-ap="${esc(u.uid)}">Aprovar…</button><button class="btn sm danger" data-rc="${esc(u.uid)}">Recusar</button></div></div>`).join("")}</section>` : ""}
    <section class="list"><div class="sechead"><h2>Usuários</h2><button class="btn sm" id="u-novo">+ Cadastrar direto</button></div>
    <div class="card" style="padding:0;overflow-x:auto"><table class="tbl"><thead><tr><th>Nome</th><th>Matrícula</th><th>Permissões</th><th>E-mail conectado</th><th>Situação</th></tr></thead><tbody>${outros.map(u => { const c = S.contas.get(u.uid); return `<tr data-u="${esc(u.uid)}" style="cursor:pointer"><td><b>${esc(u.nome)}</b></td><td>${esc(u.matricula)}</td><td class="meta">${esc(resumoPerm(u))}</td><td class="meta">${c ? esc(c.emailLocaweb) + (c.estado === "erro" ? " ⚠" : "") : "—"}</td><td><span class="chip st-${esc(u.status)}">${esc(u.status)}</span></td></tr>`; }).join("")}</tbody></table></div></section>`;
  $("aj").querySelectorAll("[data-ap]").forEach(b => b.onclick = () => editarUsuario(b.dataset.ap, true));
  $("aj").querySelectorAll("[data-u]").forEach(b => b.onclick = () => editarUsuario(b.dataset.u));
  $("aj").querySelectorAll("[data-rc]").forEach(b => b.onclick = async () => { if (b.dataset.c !== "1") { b.dataset.c = "1"; b.textContent = "Confirmar recusa"; return; } const u = S.usuarios.find(x => x.uid === b.dataset.rc); await updateDoc(doc(db, "usuarios", u.uid), { status: "recusado", recusadoEm: agoraIso() }); registrar("Acesso recusado", u.uid, u.nome); toast("Pedido recusado"); });
  $("u-novo").onclick = cadastrarDireto;
}
function formPerm(u) {
  const v = u.ver || {};
  return `<div class="grid2f"><label class="f">Perfil<select id="p-pap"><option value="usuario">Usuário</option><option value="leitura">Só leitura</option><option value="admin">Administrador</option></select></label>
    <label class="f">Situação<select id="p-st"><option value="ativo">Ativo</option><option value="suspenso">Suspenso</option><option value="pendente">Pendente</option><option value="recusado">Recusado</option></select></label></div>
    <fieldset class="card" style="display:grid;gap:8px"><legend class="hint">O que vê</legend>
    <label class="check"><input type="checkbox" id="p-prop"${v.proprios !== false ? " checked" : ""}> Os próprios fluxos (e os que recebe em cópia)</label>
    <label class="check"><input type="checkbox" id="p-tudo"${v.tudo ? " checked" : ""}> Todas as obras</label>
    <div class="tags" id="p-obras">${S.obras.map(o => `<label class="check tag" style="padding-right:10px"><input type="checkbox" value="${esc(o.codigo)}"${(v.obras || []).includes(o.codigo) ? " checked" : ""}> ${esc(obraNome(o.codigo))}</label>`).join("")}</div></fieldset>
    <label class="check"><input type="checkbox" id="p-rh"${u.rh ? " checked" : ""}> Ver RH e exames (admissões, mudanças de função, ASO)</label>
    <label class="check"><input type="checkbox" id="p-con"${u.podeConectar !== false ? " checked" : ""}> Pode conectar o próprio e-mail LocaWeb</label>
    <label class="check"><input type="checkbox" id="p-enc"${u.podeEncerrar ? " checked" : ""}> Pode encerrar e reabrir processos</label>`;
}
function lerPerm(B) {
  const papel = B.querySelector("#p-pap").value, adm = papel === "admin";
  return { papel, status: B.querySelector("#p-st").value, ver: { proprios: adm || B.querySelector("#p-prop").checked, tudo: adm || B.querySelector("#p-tudo").checked, obras: [...B.querySelectorAll("#p-obras input:checked")].map(i => i.value) },
    rh: adm || B.querySelector("#p-rh").checked, podeConectar: adm || B.querySelector("#p-con").checked, podeEncerrar: adm || (papel !== "leitura" && B.querySelector("#p-enc").checked) };
}
function editarUsuario(uid, aprovando) {
  const u = S.usuarios.find(x => x.uid === uid); if (!u) return;
  const base = aprovando ? { ...u, ver: { proprios: true, tudo: false, obras: S.obras.some(o => o.codigo === u.obraPedido) ? [u.obraPedido] : [] }, podeConectar: true } : u;
  abrir(`<h3>${aprovando ? "Aprovar acesso" : "Permissões"} — ${esc(u.nome)}</h3><p class="hint">Matrícula ${esc(u.matricula)} · ${esc(u.emailContato || "")}</p><form id="fp" style="display:grid;gap:10px">${formPerm(base)}
    <div class="row"><button class="btn primary">${aprovando ? "Aprovar" : "Salvar"}</button><button class="btn" type="button" id="p-x">Cancelar</button>${!aprovando && uid !== S.user.uid ? `<button class="btn danger" type="button" id="p-del">Remover usuário</button>` : ""}</div></form>`, B => {
    B.querySelector("#p-pap").value = u.papel || "usuario"; B.querySelector("#p-st").value = aprovando ? "ativo" : (u.status || "ativo");
    B.querySelector("#p-x").onclick = fechar;
    B.querySelector("#p-del") && (B.querySelector("#p-del").onclick = async ev => { const b = ev.target; if (b.dataset.c !== "1") { b.dataset.c = "1"; b.textContent = "Confirmar remoção"; return; } await deleteDoc(doc(db, "usuarios", uid)); try { await deleteDoc(doc(db, "contas", uid)); } catch (e) { } registrar("Usuário removido", uid, u.nome); toast("Usuário removido (o login fica bloqueado)."); fechar(); });
    B.querySelector("#fp").onsubmit = async e => { e.preventDefault(); const d = lerPerm(B); if (uid === S.user.uid && d.papel !== "admin") return toast("Você não pode tirar o seu próprio acesso de administrador.");
      try { await updateDoc(doc(db, "usuarios", uid), { ...d, ...(aprovando ? { aprovadoEm: agoraIso(), aprovadoPor: S.perfil.nome } : { alteradoEm: agoraIso() }) }); registrar(aprovando ? "Acesso aprovado" : "Permissões alteradas", uid, `${u.nome}: ${resumoPerm(d)}`); toast("Salvo"); fechar(); } catch (err) { toast(erroMsg(err)); } };
  });
}
function cadastrarDireto() {
  abrir(`<h3>Cadastrar usuário</h3><form id="fn" style="display:grid;gap:10px"><div class="grid2f"><label class="f">Nome<input id="n-nome" required></label><label class="f">Matrícula<input id="n-mat" required></label>
    <label class="f">E-mail de contato<input id="n-em" type="email"></label><label class="f">Senha inicial<input id="n-se" type="text" minlength="6" required></label></div>${formPerm({ ver: { proprios: true }, podeConectar: true })}
    <div class="row"><button class="btn primary">Cadastrar</button><button class="btn" type="button" id="n-x">Cancelar</button></div><p class="hint">Passe a matrícula e a senha inicial para a pessoa. Ela pode trocar a senha em Minha conta.</p></form>`, B => {
    B.querySelector("#p-st").value = "ativo"; B.querySelector("#n-x").onclick = fechar;
    B.querySelector("#fn").onsubmit = async e => { e.preventDefault(); const btn = e.submitter; btn.disabled = true;
      try { const sec = initializeApp(firebaseConfig, "cadastro-" + Date.now()), a2 = getAuth(sec); if (USAR_EMULADOR) connectAuthEmulator(a2, "http://127.0.0.1:9099", { disableWarnings: true });
        const mat = B.querySelector("#n-mat").value.trim().toUpperCase(); const cred = await createUserWithEmailAndPassword(a2, matEmail(mat), B.querySelector("#n-se").value); await signOut(a2);
        await setDoc(doc(db, "usuarios", cred.user.uid), { nome: B.querySelector("#n-nome").value.trim(), matricula: mat, emailContato: B.querySelector("#n-em").value.trim().toLowerCase(), criadoEm: agoraIso(), aprovadoEm: agoraIso(), aprovadoPor: S.perfil.nome, ...lerPerm(B) });
        registrar("Usuário cadastrado", cred.user.uid, mat); toast("Usuário cadastrado"); fechar();
      } catch (err) { toast(erroMsg(err)); } finally { btn.disabled = false; } };
  });
}
function ajObras() {
  $("aj").innerHTML = `<div class="sechead"><h2>Obras</h2><button class="btn sm" id="o-nova">+ Nova obra</button></div><div class="grid2">${S.obras.map(o => `<button class="item ${o.ativa === false ? "encerrado" : "aprovado"}" data-o="${esc(o.codigo)}"><div><h3>${esc(obraNome(o.codigo))}</h3><div class="meta">${esc(o.empresa || "")} · pasta “${esc(o.pasta || "")}”</div><div class="meta">Reconhece: ${esc((o.aliases || []).join(", "))}</div></div><div class="right"><span class="chip ${o.ativa === false ? "st-encerrado" : "st-ativo"}">${o.ativa === false ? "Encerrada" : "Ativa"}</span></div></button>`).join("")}</div>`;
  $("o-nova").onclick = () => editarObra(null);
  $("aj").querySelectorAll("[data-o]").forEach(b => b.onclick = () => editarObra(b.dataset.o));
}
function editarObra(cod) {
  const o = cod ? S.obras.find(x => x.codigo === cod) : { ativa: true, aliases: [] };
  abrir(`<h3>${cod ? "Editar obra" : "Nova obra"}</h3><form id="fo2" style="display:grid;gap:10px"><div class="grid2f"><label class="f">Código<input id="o-cod" value="${esc(o.codigo)}" ${cod ? "disabled" : ""} required placeholder="165"></label><label class="f">Nome<input id="o-nome" value="${esc(o.nome)}" required></label>
    <label class="f">Empresa<input id="o-emp" value="${esc(o.empresa)}" list="emps"><datalist id="emps"><option>Consórcio CMRP</option><option>Construtora Ceará Mendes</option></datalist></label><label class="f">Pasta dos PDFs<input id="o-pas" value="${esc(o.pasta)}" placeholder="preenchida sozinha"></label></div>
    <label class="f">Como aparece no assunto do e-mail <span class="opt">(separe por vírgula)</span><input id="o-al" value="${esc((o.aliases || []).join(", "))}" placeholder="165, Nova Obra X, NOVA OBRA"></label>
    <label class="check"><input type="checkbox" id="o-at"${o.ativa !== false ? " checked" : ""}> Obra ativa <span class="hint">(desmarque para encerrar; o histórico continua guardado)</span></label>
    <div class="row"><button class="btn primary">Salvar</button><button class="btn" type="button" id="o-x">Cancelar</button></div></form>`, B => {
    B.querySelector("#o-x").onclick = fechar;
    B.querySelector("#fo2").onsubmit = async e => { e.preventDefault(); const v = s => B.querySelector(s).value.trim(); const codigo = cod || v("#o-cod").toUpperCase().replace(/[\/\s]+/g, "-");
      if (!codigo || !v("#o-nome")) return toast("Preencha código e nome.");
      const al = v("#o-al").split(",").map(x => x.trim()).filter(Boolean); if (!al.includes(codigo)) al.unshift(codigo);
      try { await setDoc(doc(db, "obras", codigo), { codigo, nome: v("#o-nome"), empresa: v("#o-emp"), pasta: v("#o-pas") || `${codigo} - ${v("#o-nome")}`, aliases: al, ativa: B.querySelector("#o-at").checked }, { merge: true }); registrar(cod ? "Obra editada" : "Obra criada", codigo, v("#o-nome")); toast("Obra salva"); fechar(); } catch (err) { toast(erroMsg(err)); } };
  });
}
const linhas = s => s.split("\n").map(x => x.trim()).filter(Boolean);
const linhaEtapa = a => `<div class="row card" data-i="1" style="padding:8px"><input class="e-nome" value="${esc(a.nome)}" placeholder="Nome" style="max-width:140px"><input class="e-em" value="${esc((a.emails || []).join(", "))}" placeholder="e-mails, separados por vírgula" style="flex:1;min-width:180px"><button type="button" class="btn sm e-up" aria-label="Subir">↑</button><button type="button" class="btn sm danger e-del" aria-label="Remover">✕</button></div>`;
function listaEtapas(id, arr) { return `<div class="list" id="${id}">${(arr || []).map(linhaEtapa).join("")}</div><button type="button" class="btn sm" data-add="${id}">+ Adicionar</button>`; }
function lerEtapas(B, id) { return [...B.querySelectorAll(`#${id} [data-i]`)].map(r => ({ nome: r.querySelector(".e-nome").value.trim(), emails: r.querySelector(".e-em").value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean) })).filter(a => a.nome); }
function ajFluxo() {
  const c = S.cfg;
  $("aj").innerHTML = `<form id="ff" class="list"><div class="card" style="display:grid;gap:8px"><h2>Aprovadores, em ordem</h2><p class="hint">O pedido segue de cima para baixo. O último aprova de vez.</p>${listaEtapas("ap", c.aprovadores)}</div>
    <div class="card" style="display:grid;gap:8px"><h2>Etapa antes da primeira <span class="hint">(opcional)</span></h2><p class="hint">Ex.: Matheus, quando o pedido nasce com ele.</p>${listaEtapas("ini", c.etapasIniciais)}</div>
    <div class="card" style="display:grid;gap:8px"><h2>Substitutos</h2><p class="hint">Durante as datas, e-mails do substituto contam como a etapa do titular.</p><div class="list" id="subst">${(c.substitutos || []).map((s, i) => `<div class="row card" data-s="${i}" style="padding:8px"><input class="s-tit" value="${esc(s.titular)}" placeholder="Titular (ex.: Matheus)" style="max-width:150px"><input class="s-em" value="${esc((s.emails || []).join(", "))}" placeholder="e-mail do substituto" style="flex:1;min-width:160px"><input class="s-de" type="date" value="${esc(s.de)}" style="max-width:150px"><input class="s-ate" type="date" value="${esc(s.ate)}" style="max-width:150px"><button type="button" class="btn sm danger s-del">✕</button></div>`).join("")}</div><button type="button" class="btn sm" id="s-add">+ Substituto</button></div>
    <div class="card" style="display:grid;gap:8px"><h2>Palavras</h2><label class="check"><input type="checkbox" id="f-dir"${c.permitirAprovacaoDireta !== false ? " checked" : ""}> A primeira etapa pode aprovar direto (sem seguir para as outras)</label>
    <div class="grid2f"><label class="f">Aprovação <span class="opt">(uma por linha)</span><textarea id="f-ap" rows="8">${esc((c.palavrasAprovacao || []).join("\n"))}</textarea></label><label class="f">Devolução <span class="opt">(uma por linha)</span><textarea id="f-dev" rows="8">${esc((c.palavrasDevolucao || []).join("\n"))}</textarea></label></div>
    <p class="hint">Resposta sem nenhuma dessas palavras vira “Conferir”.</p></div><div class="row"><button class="btn primary">Salvar fluxo</button></div></form>`;
  const B = $("aj");
  B.querySelectorAll("[data-add]").forEach(b => b.onclick = () => { B.querySelector("#" + b.dataset.add).insertAdjacentHTML("beforeend", linhaEtapa({ nome: "", emails: [] })); ligarEtapas(); });
  const ligarEtapas = () => { B.querySelectorAll(".e-del").forEach(b => b.onclick = () => b.closest("[data-i]").remove()); B.querySelectorAll(".e-up").forEach(b => b.onclick = () => { const r = b.closest("[data-i]"); r.previousElementSibling && r.parentNode.insertBefore(r, r.previousElementSibling); }); B.querySelectorAll(".s-del").forEach(b => b.onclick = () => b.closest("[data-s]").remove()); };
  ligarEtapas();
  $("s-add").onclick = () => { $("subst").insertAdjacentHTML("beforeend", `<div class="row card" data-s="n" style="padding:8px"><input class="s-tit" placeholder="Titular (ex.: Matheus)" style="max-width:150px"><input class="s-em" placeholder="e-mail do substituto" style="flex:1;min-width:160px"><input class="s-de" type="date" style="max-width:150px"><input class="s-ate" type="date" style="max-width:150px"><button type="button" class="btn sm danger s-del">✕</button></div>`); ligarEtapas(); };
  $("ff").onsubmit = async e => { e.preventDefault();
    const ap = lerEtapas(B, "ap"); if (!ap.length || ap.some(a => !a.emails.length)) return toast("Cada aprovador precisa de nome e e-mail.");
    const d = { aprovadores: ap, etapasIniciais: lerEtapas(B, "ini"), permitirAprovacaoDireta: $("f-dir").checked, palavrasAprovacao: linhas($("f-ap").value), palavrasDevolucao: linhas($("f-dev").value),
      substitutos: [...B.querySelectorAll("#subst [data-s]")].map(r => ({ titular: r.querySelector(".s-tit").value.trim(), substituto: r.querySelector(".s-em").value.trim(), emails: r.querySelector(".s-em").value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean), de: r.querySelector(".s-de").value, ate: r.querySelector(".s-ate").value })).filter(s => s.titular && s.emails.length) };
    try { await updateDoc(doc(db, "config", "geral"), d); registrar("Fluxo alterado", "config/geral", ap.map(a => a.nome).join(" › ")); toast("Fluxo salvo. Vale na próxima rodada do robô."); } catch (err) { toast(erroMsg(err)); } };
}
function ajResponder() {
  const r = S.cfg.responder || {};
  $("aj").innerHTML = `<form id="fr2" class="card" style="display:grid;gap:10px"><h2>A responder</h2><p class="hint">E-mails dessas pessoas ficam na aba “A responder” até você responder.</p>
    <label class="f">Remetentes <span class="opt">(um e-mail por linha)</span><textarea id="r-rem" rows="6">${esc((r.remetentes || []).join("\n"))}</textarea></label>
    <label class="check"><input type="radio" name="modo" value="tudo"${r.modo !== "pedidos" ? " checked" : ""}> Entra tudo (você arquiva o que não precisa de resposta)</label>
    <label class="check"><input type="radio" name="modo" value="pedidos"${r.modo === "pedidos" ? " checked" : ""}> Só o que parece pedido (pergunta ou palavras abaixo)</label>
    <label class="f">Palavras de pedido <span class="opt">(uma por linha)</span><textarea id="r-pal" rows="5">${esc((r.palavras || []).join("\n"))}</textarea></label>
    <div class="row"><button class="btn primary">Salvar</button></div></form>`;
  $("fr2").onsubmit = async e => { e.preventDefault(); const d = { responder: { remetentes: linhas($("r-rem").value).map(x => x.toLowerCase()), modo: $("fr2").querySelector("input[name=modo]:checked").value, palavras: linhas($("r-pal").value) } };
    try { await updateDoc(doc(db, "config", "geral"), d); registrar("A responder alterado", "config/geral", d.responder.remetentes.join(", ")); toast("Salvo"); } catch (err) { toast(erroMsg(err)); } };
}
function ajRobo() {
  const c = S.cfg, r = S.robo || {}, rs = r.resumo || {};
  $("aj").innerHTML = `<div class="card" style="display:grid;gap:8px"><h2>Situação do robô</h2><dl class="kv"><dt>Última rodada</dt><dd>${r.ultimaRodada ? esc(fmt(r.ultimaRodada)) : "ainda não rodou"}</dd><dt>Nessa rodada</dt><dd>${esc(`${rs.emails ?? 0} e-mails · ${rs.aprovacoes ?? 0} aprovações · ${rs.pdfs ?? 0} PDFs · ${rs.erros ?? 0} erros`)}</dd><dt>Contas</dt><dd>${rs.contas ?? 0} conectadas</dd><dt>Chave</dt><dd>${r.publicKey ? "criada ✓" : "será criada na primeira rodada"}</dd></dl>
    <table class="tbl"><thead><tr><th>Usuário</th><th>E-mail</th><th>Situação</th><th>Última leitura</th></tr></thead><tbody>${[...S.contas.entries()].map(([uid, ct]) => { const u = S.usuarios.find(x => x.uid === uid); return `<tr><td>${esc(u?.nome || uid)}</td><td>${esc(ct.emailLocaweb)}</td><td><span class="chip st-${ct.estado === "erro" ? "erro" : "ativo"}">${esc(ct.estado || "—")}</span>${ct.erro ? `<div class="meta">${esc(ct.erro)}</div>` : ""}</td><td>${esc(fmt(ct.ultimaLeitura))}</td></tr>`; }).join("") || `<tr><td colspan="4" class="hint">Nenhuma conta conectada.</td></tr>`}</tbody></table></div>
    <form id="frb" class="card" style="display:grid;gap:10px"><h2>Leitura de e-mail</h2><div class="grid2f"><label class="f">Servidor IMAP<input id="i-host" value="${esc(c.imap?.host || "")}"></label><label class="f">Porta<input id="i-port" type="number" value="${esc(c.imap?.porta || 993)}"></label>
    <label class="f">Pasta de enviados <span class="opt">(vazio = descobrir sozinho)</span><input id="i-sent" value="${esc(c.imap?.pastaEnviados || "")}" placeholder="INBOX.enviadas"></label><label class="f">Dias para trás na 1ª leitura<input id="i-dias" type="number" value="${esc(c.diasIniciais ?? 20)}"></label>
    <label class="f">Tolerância de BM faltando (dias)<input id="i-tol" type="number" value="${esc(c.maquinas?.diasTolerancia ?? 5)}"></label><label class="f">Lembrete “A responder” (dias)<input id="i-lem" type="number" value="${esc(c.avisos?.diasLembreteResponder ?? 2)}"></label></div>
    <div class="row"><button class="btn primary">Salvar</button></div></form>`;
  $("frb").onsubmit = async e => { e.preventDefault(); const n = id => Number($(id).value) || 0;
    try { await updateDoc(doc(db, "config", "geral"), { imap: { host: $("i-host").value.trim(), porta: n("i-port") || 993, pastaEnviados: $("i-sent").value.trim() }, diasIniciais: n("i-dias") || 20, maquinas: { diasTolerancia: n("i-tol") }, avisos: { ...(c.avisos || {}), diasLembreteResponder: n("i-lem") } }); registrar("Robô alterado", "config/geral", $("i-host").value); toast("Salvo"); } catch (err) { toast(erroMsg(err)); } };
}
function ajImportar() {
  $("aj").innerHTML = `<div class="card" style="display:grid;gap:10px"><h2>Importar histórico</h2><p class="hint">Use o arquivo <b>historico-fluxo.json</b> que o Claude gerou a partir do painel antigo. Pode importar de novo sem duplicar: os mesmos processos são atualizados.</p>
    <input type="file" id="imp-f" accept="application/json,.json"><div id="imp-msg" class="hint"></div><div class="row"><button class="btn primary" id="imp-b" disabled>Importar</button></div></div>`;
  let dados = null;
  $("imp-f").onchange = async e => { try { dados = JSON.parse(await e.target.files[0].text()); $("imp-msg").textContent = `${(dados.processos || []).length} processos · ${(dados.equipamentos || []).length} máquinas · ${(dados.processos || []).filter(p => p._pdf).length} PDFs`; $("imp-b").disabled = false; } catch (err) { $("imp-msg").textContent = "Arquivo inválido."; } };
  $("imp-b").onclick = async () => { $("imp-b").disabled = true; let n = 0;
    try { const ops = [];
      (dados.processos || []).forEach(p => { const { _pdf, id, ...d } = p; ops.push([doc(db, "processos", id), d]); if (_pdf) ops.push([doc(db, "processos", id, "arquivo", "pdf"), _pdf]); });
      (dados.equipamentos || []).forEach(e => { const { id, ...d } = e; ops.push([doc(db, "equipamentos", id), d]); });
      for (let i = 0; i < ops.length; i += 100) { const b = writeBatch(db); ops.slice(i, i + 100).forEach(([r, d]) => b.set(r, d, { merge: true })); await b.commit(); n += Math.min(100, ops.length - i); $("imp-msg").textContent = `Importando… ${n}/${ops.length}`; }
      registrar("Histórico importado", "importar", `${(dados.processos || []).length} processos`); $("imp-msg").textContent = `Pronto: ${n} registros importados.`;
    } catch (err) { $("imp-msg").textContent = "Parou com erro: " + erroMsg(err); $("imp-b").disabled = false; } };
}
async function ajLog() {
  $("aj").innerHTML = `<div class="card"><h2>Histórico de ações</h2><div id="lg" class="hint">Carregando…</div></div>`;
  try { const s = await getDocs(query(collection(db, "log"), limit(300))); const L = s.docs.map(d => d.data()).sort((a, b) => (b.em || "").localeCompare(a.em || "")).slice(0, 150);
    $("lg").innerHTML = L.length ? `<table class="tbl"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>${L.map(l => `<tr><td>${esc(fmt(l.em))}</td><td>${esc(l.porNome)}</td><td>${esc(l.acao)}</td><td class="meta">${esc(l.detalhe)}</td></tr>`).join("")}</tbody></table>` : "Nenhuma ação registrada.";
  } catch (e) { $("lg").textContent = erroMsg(e); }
}
