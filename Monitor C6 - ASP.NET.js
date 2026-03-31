// ==UserScript==
// @name         Monitor C6 - ASP.NET
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Liberação Automática + Fix Desconexão Fantasma Pós-Login
// @author       Guilherme
// @match        https://c6.c6consig.com.br/*
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/Ante-Deguemon/TAMPERMONKEY-SCRIPTS-GL/main/GL%20CAPITAL%20C6%20Otimizado.js
// @downloadURL  https://raw.githubusercontent.com/Ante-Deguemon/TAMPERMONKEY-SCRIPTS-GL/main/GL%20CAPITAL%20C6%20Otimizado.js

// ==/UserScript==

(function () {
    'use strict';

    // --- CONFIGURAÇÕES ---
    const usuarioIDAlvo = "12391936966_004584";
    const nomeManual = "Danilo";
    const webhookURL = "https://discordapp.com/api/webhooks/1473087698939150590/itKMQn5u_3ynsU4WIpJHJFabaf3g8yy6lqt9M_YPbg_PECZKdU516PEs5dy5HmEcoeen";

    const SUPABASE_URL = "https://kakwbjkjmzsntofhhdjp.supabase.co";
    const SUPABASE_KEY = "sb_publishable_xTuLxfuPGM8_FPRbdc9Z2g_Br4ZeyRg";

    const KEY_SESSION_START = "c6_monitor_inicio";
    const TOLERANCIA_SEGUNDOS = 5;
    let contadorAusencia = 0;

    // Estados locais da fila: 'ausente', 'espera', 'sua_vez', 'online'
    let statusFila = "ausente";
    let tentandoEntrar = false;
    let usuarioAtivoNoMomento = "Ninguém";
    let filaRecente = [];
    let minhaPosicaoFila = 0;
    let isInternalNavigation = false;

    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }

    // --- SEGURANÇA E STORAGE ---
    function sanitizarHTML(texto) {
        if (!texto) return "";
        return texto.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    const getHoraInicio = () => sessionStorage.getItem(KEY_SESSION_START);
    const setHoraInicio = (d) => sessionStorage.setItem(KEY_SESSION_START, d.toString());
    const limparSessao = () => sessionStorage.removeItem(KEY_SESSION_START);

    // --- UTILS ---
    const formatarHora = (d) => new Date(d).toLocaleTimeString('pt-BR');

    function calcularDuracao(inicioStr, fimDate) {
        if (!inicioStr) return "Indeterminado";
        const diff = fimDate - new Date(inicioStr);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        return `${m}m ${s}s`;
    }

    function dispararNotificacaoDaVez() {
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification("🟢 Chegou a sua vez no C6!", {
                body: "O sistema está livre. Você já pode fazer login no site.",
                icon: "https://c6.c6consig.com.br/favicon.ico",
                requireInteraction: true
            });
        }
    }

    function enviarParaDiscord(tipo, dados, viaBeacon = false) {
            if (webhookURL === "*") return;

            const embed = {
                title: tipo === 'entrada' ? "✅ SESSÃO INICIADA" : "❌ SESSÃO ENCERRADA",
                color: tipo === 'entrada' ? 3066993 : 15158332,
                fields: [
                    { name: "👤 Utilizador", value: nomeManual, inline: true },
                    { name: "🆔 ID", value: usuarioIDAlvo, inline: true },
                    { name: tipo === 'entrada' ? "🕒 Entrada" : "🕒 Saída", value: formatarHora(dados.hora) }
                ],
                footer: { text: "Monitor C6 - ASP.NET v4.0" },
                timestamp: new Date()
            };

            if (tipo === 'saida') embed.fields.push({ name: "⏱️ Tempo Total", value: dados.duracao, inline: true });

            const payload = JSON.stringify({ embeds: [embed] });

            if (viaBeacon) {
                // CORREÇÃO: Usar Blob para forçar o Content-Type que o Discord aceita
                const blob = new Blob([payload], { type: 'application/json' });
                navigator.sendBeacon(webhookURL, blob);
            } else {
                GM_xmlhttpRequest({ method: "POST", url: webhookURL, headers: { "Content-Type": "application/json" }, data: payload });
            }
        }
    // --- SUPABASE CORE ---
    async function tentarEntrar() {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/tentar_entrar`, {
            method: "POST", headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ novo_usuario: nomeManual })
        });
        return await res.text();
    }

    async function liberarSessao() {
        await fetch(`${SUPABASE_URL}/rest/v1/controle_sessao?id=eq.1`, {
            method: "PATCH", headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ ativo: false, usuario_ativo: null })
        });
        await fetch(`${SUPABASE_URL}/rest/v1/fila_espera?usuario=eq.${nomeManual}`, {
            method: "DELETE", headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
        });
    }

    function liberarSessaoSincrono() {
        fetch(`${SUPABASE_URL}/rest/v1/controle_sessao?id=eq.1`, {
            method: "PATCH", headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ ativo: false, usuario_ativo: null }), keepalive: true
        });
        fetch(`${SUPABASE_URL}/rest/v1/fila_espera?usuario=eq.${nomeManual}`, {
            method: "DELETE", headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }, keepalive: true
        });
    }

    async function atualizarDadosFila() {
        try {
            const resFila = await fetch(`${SUPABASE_URL}/rest/v1/fila_espera?select=usuario&order=entrou_em`, { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } });
            filaRecente = (await resFila.json()).map(x => x.usuario);

            const resSessao = await fetch(`${SUPABASE_URL}/rest/v1/controle_sessao?id=eq.1&select=usuario_ativo,ativo`, { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } });
            const dataSessao = await resSessao.json();
            usuarioAtivoNoMomento = (dataSessao.length > 0 && dataSessao[0].ativo && dataSessao[0].usuario_ativo) ? dataSessao[0].usuario_ativo : "Ninguém";
        } catch (error) { throw error; }
    }

    // --- FUNÇÃO PARA ENTRAR NA FILA MANUALMENTE ---
    async function entrarNaFilaManual() {
        const btn = document.getElementById("btn-join-queue");
        if(btn) { btn.innerText = "Aguarde..."; btn.disabled = true; }

        tentandoEntrar = true;
        try {
            const res = await tentarEntrar();
            if (res.includes("ENTROU")) {
                statusFila = "sua_vez";
                dispararNotificacaoDaVez();
            } else if (res.includes("FILA")) {
                statusFila = "espera";
                minhaPosicaoFila = res.split(":")[1] || "?";
            }
        } catch(e) { console.error(e); }
        finally { tentandoEntrar = false; renderizarVisualUnificado(); }
    }

    // --- ESCUTA O CLIQUE DO BOTÃO INJETADO ---
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'btn-join-queue') {
            e.preventDefault();
            entrarNaFilaManual();
        }
    });

    // --- UI E BADGE ---
    function inicializarBadge() {
        let b = document.getElementById("badge-c6-monitor");
        if (!b) {
            const style = document.createElement("style");
            style.innerHTML = `
                @keyframes pulsoLaranja { 0%{box-shadow: 0 0 0 0 rgba(253, 126, 20, 0.7);} 70%{box-shadow: 0 0 0 10px rgba(253, 126, 20, 0);} 100%{box-shadow: 0 0 0 0 rgba(253, 126, 20, 0);} }
                @keyframes pulsoVerde { 0%{box-shadow: 0 0 0 0 rgba(0, 255, 0, 0.7);} 70%{box-shadow: 0 0 0 10px rgba(0, 255, 0, 0);} 100%{box-shadow: 0 0 0 0 rgba(0, 255, 0, 0);} }
                .relogio-mono { font-family: 'Consolas', monospace; font-size: 1.2em; font-weight: bold; }
                .titulo-online { font-size: 0.9em; opacity: 0.9; border-bottom: 1px solid rgba(255,255,255,0.3); margin-bottom: 5px; padding-bottom: 3px; }
            `;
            document.head.appendChild(style);
            b = document.createElement("div");
            b.id = "badge-c6-monitor";
            b.style.cssText = "position: fixed; bottom: 20px; right: 20px; background-color: rgb(40, 167, 69); color: white; padding: 12px 18px; border-radius: 8px; font-family: sans-serif; font-size: 14px; z-index: 999999; box-shadow: 0 4px 6px rgba(0,0,0,0.3); text-align: center; min-width: 180px; transition: all 0.3s ease;";
            document.body.appendChild(b);
        }
        return b;
    }

    function renderizarVisualUnificado() {
        const b = inicializarBadge();
        let conteudo = "";

        if (statusFila === "online") {
            b.style.backgroundColor = "#28a745"; b.style.animation = "none"; b.style.opacity = "1";
            const inicioStr = getHoraInicio();
            if (inicioStr) {
                const diff = new Date() - new Date(inicioStr);
                const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0'), s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
                conteudo = `🟢 VOCÊ ESTÁ NO DIGITADOR<br><span class="relogio-mono">${h > 0 ? h + ':' : ''}${m}:${s}</span>`;
            } else { conteudo = `🟢 VOCÊ ESTÁ NO DIGITADOR<br><span class="relogio-mono">00:00</span>`; }
        } else if (statusFila === "sua_vez") {
            b.style.backgroundColor = "#28a745"; b.style.color = "#fff"; b.style.animation = "pulsoVerde 2s infinite"; b.style.opacity = "1";
            conteudo = `🟢 SUA VEZ!<br><small>O sistema está livre, pode entrar.</small>`;
        } else if (statusFila === "espera") {
            b.style.backgroundColor = "#fd7e14"; b.style.animation = "pulsoLaranja 2s infinite"; b.style.opacity = "1";
            conteudo = `⏳ NA FILA<br>Posição: ${minhaPosicaoFila}º`;
        } else {
            if (contadorAusencia > 0 && contadorAusencia < TOLERANCIA_SEGUNDOS) {
                b.style.backgroundColor = "#ffc107"; b.style.color = "#000"; b.style.animation = "pulsoVerde 2s infinite";
                conteudo = `⚠️ VERIFICANDO... (${contadorAusencia}/${TOLERANCIA_SEGUNDOS})`;
            } else {
                b.style.backgroundColor = "rgb(200, 50, 50)"; b.style.color = "#fff"; b.style.animation = "none"; b.style.opacity = "0.9";
                if (verificarSeEstaNaTelaLogin()) {
                    conteudo = `🔴 AGUARDANDO AÇÃO<br><button id="btn-join-queue" style="margin-top:8px; width: 100%; padding: 8px; background: #007bff; color: white; border: 1px solid #0056b3; border-radius: 4px; font-weight: bold; cursor: pointer;">👉 Entrar na Fila</button>`;
                } else { conteudo = `🔴 AUSENTE`; }
            }
        }

        if (contadorAusencia === 0 || statusFila === "ausente" || statusFila === "espera" || statusFila === "sua_vez") {
            conteudo += `<div style="margin-top: 10px; text-align: left; font-size: 13px; color: ${b.style.backgroundColor === 'rgb(255, 193, 7)' ? '#000' : '#fff'};">`;
            conteudo += `<div class="titulo-online">🖥️ <b>Online:</b> ${sanitizarHTML(usuarioAtivoNoMomento)}</div>`;
            if (filaRecente.length > 0) {
                conteudo += `👥 <b>Fila:</b><br>`;
                filaRecente.forEach((user, index) => { conteudo += `${index + 1}. ${sanitizarHTML(user)} ${user === nomeManual ? "(Você)" : ""}<br>`; });
            } else { conteudo += `👥 <b>Fila:</b> Vazia`; }
            conteudo += `</div>`;
        }

        if (b.innerHTML !== conteudo) b.innerHTML = conteudo;
    }

    // --- DETEÇÃO ---
    function verificarSeEstaNaTelaLogin() {
        // Confirma que está na tela de login pela URL ou pelos campos principais
        return window.location.href.toLowerCase().includes('/login/') ||
               document.getElementById('EUsuario_CAMPO') !== null ||
               document.getElementById('ESenha_CAMPO') !== null;
    }

    function verificarLogadoNoSistema() {
        // 1. Se os campos de login estão explícitos na tela, definitivamente não estamos logados
        if (verificarSeEstaNaTelaLogin()) return false;

        // --- DAQUI PARA BAIXO ESTAMOS FORA DA TELA DE LOGIN ---

        // 2. Prova absoluta: O token de sessão (Session Storage) gravado ao clicar em "Entrar" existe?
        if (getHoraInicio() !== null) return true;

        // 3. Prova HTML: Existem scripts ou elementos que só carregam no painel interno?
        if (document.querySelector('script[src*="fimenu"]')) return true;
        if (document.title.includes("Autorizador Web")) return true;

        // 4. Prova Clássica (Fallback): Procura pelo ID em elementos antigos caso a estrutura mude
        const elPadrao = document.getElementById("ctl00_L_Usuario");
        if (elPadrao && elPadrao.innerText.trim().includes(usuarioIDAlvo)) return true;
        const todosSpans = document.getElementsByTagName("span");
        for (let span of todosSpans) { if (span.innerText.trim().includes(usuarioIDAlvo)) return true; }

        return false;
    }

    // --- BLOQUEIO E RESERVA NA HORA DO LOGIN ---
    function blindarFormularioLogin() {
        const btnEntrar = document.getElementById('lnkEntrar');
        const inputSenha = document.getElementById('ESenha_CAMPO');

        async function tentarLoginNativo(e) {
            e.preventDefault();
            e.stopImmediatePropagation();

            if (statusFila === "sua_vez") {
                const txtOriginal = btnEntrar ? btnEntrar.innerText : "";
                if(btnEntrar) btnEntrar.innerText = "Aguarde...";

                try {
                    const res = await tentarEntrar();
                    if (res.includes("ENTROU")) {
                        statusFila = "online";
                        isInternalNavigation = true; // Libera o navegador para fazer o postback
                        if (btnEntrar && btnEntrar.getAttribute('href') && btnEntrar.getAttribute('href').startsWith('javascript:')) {
                            eval(btnEntrar.getAttribute('href').replace('javascript:', ''));
                        }
                    } else if (res.includes("FILA")) {
                        statusFila = "espera";
                        minhaPosicaoFila = res.split(":")[1] || "?";
                        renderizarVisualUnificado();
                        alert("⚠️ Quase! Outro usuário entrou um milissegundo antes de você.\nVocê foi colocado na fila.");
                    }
                } catch(err) {
                    console.error(err);
                } finally {
                    if(btnEntrar) btnEntrar.innerText = txtOriginal;
                }
            } else if (statusFila === "online") {
                isInternalNavigation = true;
                if (btnEntrar && btnEntrar.getAttribute('href') && btnEntrar.getAttribute('href').startsWith('javascript:')) {
                    eval(btnEntrar.getAttribute('href').replace('javascript:', ''));
                }
            } else {
                alert("⚠️ ACESSO BLOQUEADO!\n\nAlguém já está utilizando o sistema ou há fila. Clique em 'Entrar na Fila' na badge abaixo.");
            }
        }

        if (btnEntrar && !btnEntrar.dataset.blindado) {
            btnEntrar.dataset.blindado = "true";
            btnEntrar.addEventListener('click', tentarLoginNativo, true);
        }
        if (inputSenha && !inputSenha.dataset.blindado) {
            inputSenha.dataset.blindado = "true";
            inputSenha.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') tentarLoginNativo(e);
            }, true);
        }
    }

    // --- AÇÕES GLOBAIS ---
    function registrarEntradaSeNecessario() {
        if (!getHoraInicio()) {
            const agora = new Date();
            setHoraInicio(agora);
            enviarParaDiscord('entrada', { hora: agora });
        }
    }

    function finalizarSessao() {
        const inicio = getHoraInicio();
        if (inicio) {
            enviarParaDiscord('saida', { hora: new Date(), duracao: calcularDuracao(inicio, new Date()) });
        }
        liberarSessao();
        limparSessao();
        statusFila = "ausente";
    }

    async function processarEntrada() {
        if (tentandoEntrar) return;
        tentandoEntrar = true;

        try {
            const resultado = await tentarEntrar();
            if (resultado.includes("ENTROU")) {
                statusFila = "online";
                registrarEntradaSeNecessario();
            } else if (resultado.includes("FILA")) {
                statusFila = "espera";
                minhaPosicaoFila = resultado.split(":")[1] || "?";
            }
        } catch (e) {
            console.error(e);
        } finally {
            tentandoEntrar = false;
        }
    }

    function monitorarPresenca() {
        const logadoNoSistema = verificarLogadoNoSistema();

        if (logadoNoSistema) {
            contadorAusencia = 0;

            // garante que o timer comece mesmo se o status já estiver "online"
            if (statusFila !== "online") {
                processarEntrada();
            } else {
                registrarEntradaSeNecessario();
            }
        } else {
            if (statusFila === "online") {
                contadorAusencia++;
                if (contadorAusencia >= TOLERANCIA_SEGUNDOS) {
                    finalizarSessao();
                    contadorAusencia = 0;
                }
            }
        }

        blindarFormularioLogin();
    }

    // --- GESTORES DE LOOP DE REDE ---
    let falhasConsecutivasFila = 0;

    async function loopAtualizarFila() {
        try {
            await atualizarDadosFila();

            const sessaoLivre = (usuarioAtivoNoMomento === "Ninguém" || !usuarioAtivoNoMomento);
            const filaVazia = (filaRecente.length === 0);
            const souOPrimeiro = (filaRecente.length > 0 && filaRecente[0] === nomeManual);

            // 1. Se estava na fila de espera, avança automaticamente
            if (statusFila === "espera" && !tentandoEntrar) {
                if (sessaoLivre && souOPrimeiro) {
                    const res = await tentarEntrar();
                    if (res.includes("ENTROU")) {
                        statusFila = "sua_vez";
                        dispararNotificacaoDaVez();
                    } else if (res.includes("FILA")) {
                        minhaPosicaoFila = res.split(":")[1] || "?";
                    }
                }
            }

            // 2. LIBERAÇÃO AUTOMÁTICA
            if (statusFila === "ausente" && verificarSeEstaNaTelaLogin()) {
                if (sessaoLivre && filaVazia) {
                    statusFila = "sua_vez";
                }
            }

            // 3. Fallback: Alguém entrou enquanto você lia a tela "sua vez"
            if (statusFila === "sua_vez" && verificarSeEstaNaTelaLogin()) {
                if (!sessaoLivre && usuarioAtivoNoMomento !== nomeManual) {
                    statusFila = "ausente";
                }
            }

            // 4. Fallback de persistência
            if (statusFila === "ausente" && usuarioAtivoNoMomento === nomeManual && verificarLogadoNoSistema()) {
                statusFila = "online";
            }

            falhasConsecutivasFila = 0;
        } catch (error) { falhasConsecutivasFila = Math.min(falhasConsecutivasFila + 1, 6); }

        setTimeout(loopAtualizarFila, 5000 + Math.random() * 2000 + ((Math.pow(2, falhasConsecutivasFila) - 1) * 1000));
    }

    function loopRenderizacao() {
        renderizarVisualUnificado();
        requestAnimationFrame(loopRenderizacao);
    }


        // --- VARIÁVEIS DE CONTROLE ---
        let ultimaInteracaoPagina = 0;   // timestamp do último mousedown/click/key/touch
        let clicouEmSair = false;        // flag explícita para o botão "Sair"
        const JANELA_INTERACAO_MS = 10000; // 10s — janela generosa para postbacks lentos

        // --- DETECTOR UNIVERSAL DE INTERAÇÃO ---
        // Usa capturing phase para pegar TUDO, inclusive eventos inline do ASP.NET
        function registrarInteracao(e) {
            // Verifica se é clique no botão "Sair" / "Logout"
            const el = e.target;
            if (el) {
                const textoEl = (el.innerText || "").trim().toLowerCase();
                const idEl = (el.id || "").toLowerCase();
                const elPai = el.closest && el.closest('[id*="sair" i], [id*="logout" i], [id*="logoff" i]');

                if (textoEl === "sair" || idEl.includes("sair") || idEl.includes("logout") || idEl.includes("logoff") || elPai) {
                    clicouEmSair = true;
                    // Não registra como interação interna — queremos que o webhook dispare
                    return;
                }
            }

            clicouEmSair = false;
            ultimaInteracaoPagina = Date.now();
        }

        // Registra em TODOS os tipos de interação possíveis, na fase de captura
        ["mousedown", "click", "pointerdown", "touchstart"].forEach(evt => {
            window.addEventListener(evt, registrarInteracao, true);
        });

        // Teclado — Enter, Tab, etc. também disparam postbacks no ASP.NET
        window.addEventListener("keydown", (e) => {
            const tecla = e.key ? e.key.toLowerCase() : "";

            // F5 / Ctrl+R = refresh intencional
            if (tecla === "f5" || (e.ctrlKey && tecla === "r")) {
                e.preventDefault();
                ultimaInteracaoPagina = Date.now();
                window.location.reload();
                return;
            }

            // Qualquer tecla pressionada dentro da página = interação interna
            ultimaInteracaoPagina = Date.now();
        }, true);

        // Formulários submetidos = navegação interna com certeza
        window.addEventListener("submit", () => {
            ultimaInteracaoPagina = Date.now();
        }, true);

        // Dropdowns com AutoPostBack
        window.addEventListener("change", () => {
            ultimaInteracaoPagina = Date.now();
        }, true);

        // --- INTERCEPTAÇÃO DO isInternalNavigation (mantida para compatibilidade com blindarFormularioLogin) ---
        window.addEventListener("click", (e) => {
            const el = e.target.closest('a, button, input[type="submit"], input[type="button"], tr, td, span, div.btn');
            if (el) {
                const texto = (el.innerText || "").toLowerCase();
                const id = (el.id || "").toLowerCase();
                const ehSair = texto.includes("sair") || id.includes("sair") || id.includes("logout") || id.includes("logoff");
                if (!ehSair) {
                    isInternalNavigation = true;
                    setTimeout(() => { isInternalNavigation = false; }, 4000);
                }
            }
        }, true);

        // --- O BEFOREUNLOAD COM LÓGICA INVERTIDA ---
        window.addEventListener("beforeunload", (e) => {
            // PASSO 1: Se clicou explicitamente em "Sair", sempre envia o webhook
            if (clicouEmSair) {
                if (statusFila !== "ausente") {
                    const inicio = getHoraInicio();
                    if (inicio) enviarParaDiscord('saida', { hora: new Date(), duracao: calcularDuracao(inicio, new Date()) }, true);
                    liberarSessaoSincrono();
                    limparSessao();
                    statusFila = "ausente";
                }
                return;
            }

            // PASSO 2: Houve interação recente na página?
            const tempoDesdeInteracao = Date.now() - ultimaInteracaoPagina;
            const houveInteracaoRecente = tempoDesdeInteracao < JANELA_INTERACAO_MS;

            // Se houve interação recente = navegação interna (postback, botão Voltar, etc.)
            // → NÃO envia webhook, apenas retorna silenciosamente
            if (houveInteracaoRecente) {
                console.log(`[C6 Monitor] beforeunload BLOQUEADO — interação há ${tempoDesdeInteracao}ms atrás`);
                return;
            }

            // PASSO 3: Nenhuma interação recente = o usuário fechou a aba pelo X
            // → Envia o webhook de saída
            console.log(`[C6 Monitor] beforeunload LIBERADO — sem interação há ${tempoDesdeInteracao}ms (fechou a aba)`);
            if (statusFila !== "ausente") {
                const inicio = getHoraInicio();
                if (inicio) enviarParaDiscord('saida', { hora: new Date(), duracao: calcularDuracao(inicio, new Date()) }, true);
                liberarSessaoSincrono();
                limparSessao();
                statusFila = "ausente";
            }
        });

        console.log("C6 Monitor v12.0 (Lógica Invertida — Anti Falso Positivo) carregado.");

            atualizarDadosFila().then(() => {
                loopAtualizarFila();
                setInterval(monitorarPresenca, 1000);
                requestAnimationFrame(loopRenderizacao);
            });

        })();