// ==UserScript==
// @name         GL CAPITAL C6 Otimizado
// @namespace    GLGM1
// @version      1.1.0
// @description  Automatiza processos internos no sistema C6 Consig (ultra-rápido e leve)
// @author       Guilherme
// @match        https://c6.c6consig.com.br/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Ante-Deguemon/TAMPERMONKEY-SCRIPTS-GL/main/GL CAPITAL C6 Otimizado.js
// @downloadURL  https://raw.githubusercontent.com/Ante-Deguemon/TAMPERMONKEY-SCRIPTS-GL/main/GL CAPITAL C6 Otimizado.js
// ==/UserScript==

(function () {
  'use strict';

  let cpfPreenchido = false;
  let dddPreenchido = false;
  let celularPreenchido = false;
  let captchaReady = false;

  // ==== DEFINIR PROPOSTA NOVA ====
  const intervaloProposta = setInterval(() => {
    const select = document.getElementById(
      'ctl00_Cph_UcPrp_FIJN1_JnDadosIniciais_UcDIni_cboTipoOperacao_CAMPO'
    );
    if (select && select.value !== 'MargemLivre') {
      select.value = 'MargemLivre';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (select && select.value === 'MargemLivre') {
      clearInterval(intervaloProposta); // Para o intervalo depois de aplicar
      console.log('Proposta Nova definida');
    }
  }, 1);

  // ==== DEFINIR TIPO DE PRODUTO ====
  const intervaloProduto = setInterval(() => {
    const select = document.getElementById(
      'ctl00_Cph_UcPrp_FIJN1_JnDadosIniciais_UcDIni_cboTipoProduto_CAMPO'
    );
    if (select && select.value !== '0001') {
      select.value = '0001';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (select && select.value === '0001') {
      clearInterval(intervaloProduto);
      console.log('Tipo de Produto definido');
    }
  }, 1);

  // ==== DEFINIR GRUPO DE CONVÊNIO ====
  const intervaloConvenio = setInterval(() => {
    const select = document.getElementById(
      'ctl00_Cph_UcPrp_FIJN1_JnDadosIniciais_UcDIni_cboGrupoConvenio_CAMPO'
    );
    if (select && select.value !== '4') {
      select.value = '4';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (select && select.value === '4') {
      clearInterval(intervaloConvenio);
      console.log('Grupo de Convênio definido');
    }
  }, 1);

  // ==== DIGITAL + CPF + DDD + CELULAR (FLUXO CONTROLADO) ====
  const intervaloFormalizacao = setInterval(() => {
    const radioDigital = document.getElementById(
      'ctl00_Cph_UcPrp_FIJN1_JnDadosIniciais_UcDIni_rblTpFormalizacao_1'
    );

    if (!radioDigital) return;

    if (!radioDigital.checked) {
      radioDigital.checked = true;
      radioDigital.dispatchEvent(new Event('click', { bubbles: true }));
      return;
    }

    // CPF
    const cpfInput = document.getElementById(
      'ctl00_Cph_UcPrp_FIJN1_JnDadosIniciais_UcDIni_txtCpfCPD_CAMPO'
    );
    if (cpfInput && !cpfPreenchido) {
      cpfInput.value = cpf;
      cpfInput.dispatchEvent(new Event('input', { bubbles: true }));
      cpfInput.dispatchEvent(new Event('change', { bubbles: true }));
      cpfInput.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 })
      );
      cpfPreenchido = true;
      console.log('CPF preenchido');
      return;
    }

    // DDD
    const dddInput = document.getElementById(
      'ctl00_Cph_UcPrp_FIJN1_JnDadosIniciais_UcDIni_txtDddCPD_CAMPO'
    );
    if (dddInput && cpfPreenchido && !dddPreenchido) {
      dddInput.value = ddd;
      dddInput.dispatchEvent(new Event('input', { bubbles: true }));
      dddInput.dispatchEvent(new Event('change', { bubbles: true }));
      dddInput.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 })
      );
      dddPreenchido = true;
      console.log('DDD preenchido');
      return;
    }

    // CELULAR
    const celularInput = document.getElementById(
      'ctl00_Cph_UcPrp_FIJN1_JnDadosIniciais_UcDIni_txtCelularCPD_CAMPO'
    );
    if (celularInput && dddPreenchido && !celularPreenchido) {
      celularInput.value = celular;
      celularInput.dispatchEvent(new Event('input', { bubbles: true }));
      celularInput.dispatchEvent(new Event('change', { bubbles: true }));
      celularInput.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 })
      );
      celularPreenchido = true;
      console.log('Celular preenchido');
      clearInterval(intervaloFormalizacao); // Para de tentar depois que tudo é preenchido
    }
  }, 1);

  // ==== MONITORA CAPTCHA DO CAPMONSTER ====
  const intervaloCaptcha = setInterval(() => {
    const captchaSpan = document.querySelector('.cm-addon-recaptcha .cm-addon-inner span');
    if (captchaSpan && captchaSpan.textContent.includes('Ready')) {
      captchaReady = true;
      console.log('Captcha Ready detectado');
      clearInterval(intervaloCaptcha);
    }
  }, 1);

  // ==== CLICAR NO BOTÃO CONFIRMAR APÓS CAPTCHA ====
  const intervaloConfirmar = setInterval(() => {
    if (!captchaReady) return;
    const confirmar = document.querySelector('#ctl00_cph_JN_ctl00_UcBotoes_btnConfirmar_dvBtn');
    if (confirmar) {
      confirmar.click();
      console.log('Botão Confirmar clicado');
      captchaReady = false;
      clearInterval(intervaloConfirmar);
    }
  }, 1);

})();
