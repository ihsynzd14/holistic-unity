/* ==================== SHARED JS — HOLISTIC UNITY ==================== */

/* ==================== LANGUAGE ==================== */
var currentLang = 'en';

function setLang(lang) {
  currentLang = lang;
  document.getElementById('langEn').classList.toggle('active', lang === 'en');
  document.getElementById('langIt').classList.toggle('active', lang === 'it');
  document.getElementById('langPt').classList.toggle('active', lang === 'pt');
  document.documentElement.lang = lang;

  document.querySelectorAll('[data-en]').forEach(function(el) {
    var text = el.getAttribute('data-' + lang);
    if (text) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = text;
      else if (el.tagName === 'OPTION') el.textContent = text;
      else el.innerHTML = text;
    }
  });
  try { localStorage.setItem('hu_lang', lang); } catch(e) {}
}

(function initLang() {
  var saved = null;
  try { saved = localStorage.getItem('hu_lang'); } catch(e) {}
  var b = (navigator.language || 'en').slice(0, 2).toLowerCase();
  var lang = saved || (['en', 'it', 'pt'].indexOf(b) >= 0 ? b : 'en');
  setLang(lang);
})();

/* ==================== MOBILE MENU ==================== */
function toggleMenu() {
  var navLinks = document.getElementById('navLinks');
  var hamburger = document.getElementById('hamburger');
  navLinks.classList.toggle('open');
  hamburger.classList.toggle('open');
  var expanded = navLinks.classList.contains('open');
  hamburger.setAttribute('aria-expanded', expanded);
}

/* Mobile dropdown toggle */
var dropdownToggle = document.querySelector('.nav-dropdown > a');
if (dropdownToggle) {
  dropdownToggle.addEventListener('click', function(e) {
    if (window.innerWidth <= 768) {
      e.preventDefault();
      e.stopPropagation();
      this.parentElement.classList.toggle('open');
    }
  });
}

document.querySelectorAll('.nav-links a').forEach(function(link) {
  link.addEventListener('click', function() {
    /* Don't close menu when clicking the dropdown toggle on mobile */
    if (this.parentElement.classList.contains('nav-dropdown') && window.innerWidth <= 768) return;
    document.getElementById('navLinks').classList.remove('open');
    var hamburger = document.getElementById('hamburger');
    hamburger.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    /* Also close dropdown */
    var dd = document.querySelector('.nav-dropdown');
    if (dd) dd.classList.remove('open');
  });
});

/* ==================== NAVBAR SCROLL ==================== */
window.addEventListener('scroll', function() {
  var navbar = document.getElementById('navbar');
  if (window.scrollY > 50) navbar.classList.add('scrolled');
  else navbar.classList.remove('scrolled');
});

/* ==================== SCROLL ANIMATIONS ==================== */
var revealObserver = new IntersectionObserver(function(entries) {
  entries.forEach(function(entry) {
    if (entry.isIntersecting) entry.target.classList.add('visible');
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale').forEach(function(el) {
  revealObserver.observe(el);
});

/* ==================== FAQ ACCORDION ==================== */
function toggleFAQ(btn) {
  var item = btn.closest('.faq-item');
  var isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach(function(el) { el.classList.remove('open'); });
  if (!isOpen) item.classList.add('open');
}

/* ==================== COOKIE CONSENT + GATED GOOGLE ANALYTICS ====================
 * GDPR / CNIL / Garante posture: analytics cookies (Google Analytics)
 * are NOT loaded until the user explicitly consents via the banner
 * below. Essential cookies (session, language preference, consent
 * record itself) are set without consent because they are strictly
 * necessary to provide requested functionality — exempt under GDPR
 * recital 30 / ePrivacy Directive Art 5(3).
 *
 * Consent state is stored as JSON in localStorage under `hu_cookie_consent`:
 *   { analytics: boolean, marketing: boolean, timestamp: ISO8601, version: int }
 * A missing or null value means "no decision yet" — banner shows.
 * A present value means "decided" — banner hidden unless re-opened via
 * `huOpenCookieSettings()` (wired to the footer link).
 *
 * If the consent schema ever changes (new category, revoked category,
 * updated wording), bump CONSENT_VERSION to force re-prompt.
 */
(function() {
  var CONSENT_KEY = 'hu_cookie_consent';
  var CONSENT_VERSION = 2;
  var GA_ID = 'G-0WEMYZ5DZ0';

  function getConsent() {
    try {
      var raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      // Invalidate old schema versions so users see the new banner after
      // we change the categories or wording.
      if (parsed.version !== CONSENT_VERSION) return null;
      return parsed;
    } catch (e) { return null; }
  }

  function saveConsent(consent) {
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify({
        analytics: !!consent.analytics,
        marketing: !!consent.marketing,
        timestamp: new Date().toISOString(),
        version: CONSENT_VERSION
      }));
    } catch (e) {}
  }

  function loadGoogleAnalytics() {
    if (window.__huGALoaded) return;
    window.__huGALoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function() { dataLayer.push(arguments); };
    gtag('js', new Date());
    // `anonymize_ip` masks the last octet of the client IP at Google's
    // edge — required by CNIL guidance for GA in EU.
    gtag('config', GA_ID, { anonymize_ip: true });
  }

  // Meta Pixel — loaded only after marketing consent. The inline pixel
  // snippet was removed from all HTML files; this function reproduces
  // the Facebook-standard init + PageView, then dynamically loads the
  // custom events module (`shared-pixel-events.js`) which adds click,
  // scroll and engagement handlers.
  var META_PIXEL_ID = '1445760663897743';
  function loadMetaPixel() {
    if (window.__huMetaLoaded) return;
    window.__huMetaLoaded = true;
    /* eslint-disable */
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    fbq('init', META_PIXEL_ID);
    fbq('track', 'PageView');
    // Load the custom events module after the pixel snippet so that
    // discipline-page ViewContent + click/scroll handlers attach with
    // the queue stub already in place.
    var ev = document.createElement('script');
    ev.async = true;
    ev.src = '/shared-pixel-events.js';
    document.head.appendChild(ev);
  }

  var i18n = {
    heading: {
      en: 'Your privacy choices',
      it: 'Le tue scelte sulla privacy',
      pt: 'Suas escolhas de privacidade'
    },
    body: {
      en: 'We use essential cookies to make this site work. We\u2019d also like to set optional analytics cookies to help us understand how visitors use the site. We won\u2019t set analytics cookies unless you accept.',
      it: 'Usiamo cookie essenziali per far funzionare il sito. Vorremmo anche impostare cookie di analisi opzionali per capire come i visitatori usano il sito. Non li imposteremo senza il tuo consenso.',
      pt: 'Usamos cookies essenciais para o funcionamento do site. Gostar\u00edamos tamb\u00e9m de definir cookies de an\u00e1lise opcionais para entender como os visitantes usam o site. N\u00e3o os definiremos sem o seu consentimento.'
    },
    acceptAll: {
      en: 'Accept all',
      it: 'Accetta tutto',
      pt: 'Aceitar tudo'
    },
    rejectAll: {
      en: 'Reject non-essential',
      it: 'Rifiuta non essenziali',
      pt: 'Rejeitar n\u00e3o essenciais'
    },
    customize: {
      en: 'Customize',
      it: 'Personalizza',
      pt: 'Personalizar'
    },
    essentialLabel: {
      en: 'Essential (always on)',
      it: 'Essenziali (sempre attivi)',
      pt: 'Essenciais (sempre ativos)'
    },
    essentialDesc: {
      en: 'Authentication, security, language preference. Exempt from consent under ePrivacy Directive.',
      it: 'Autenticazione, sicurezza, preferenza di lingua. Esenti dal consenso ai sensi della Direttiva ePrivacy.',
      pt: 'Autentica\u00e7\u00e3o, seguran\u00e7a, prefer\u00eancia de idioma. Isentos de consentimento nos termos da Diretiva ePrivacy.'
    },
    analyticsLabel: {
      en: 'Analytics',
      it: 'Analisi',
      pt: 'An\u00e1lise'
    },
    analyticsDesc: {
      en: 'Google Analytics (G-0WEMYZ5DZ0). Aggregated usage stats with IP anonymization.',
      it: 'Google Analytics (G-0WEMYZ5DZ0). Statistiche d\u2019uso aggregate con anonimizzazione IP.',
      pt: 'Google Analytics (G-0WEMYZ5DZ0). Estat\u00edsticas de uso agregadas com anonimiza\u00e7\u00e3o de IP.'
    },
    marketingLabel: {
      en: 'Marketing',
      it: 'Marketing',
      pt: 'Marketing'
    },
    marketingDesc: {
      en: 'Meta Pixel (Facebook/Instagram). Loaded only after consent. Used for measuring ad performance and remarketing.',
      it: 'Meta Pixel (Facebook/Instagram). Caricato solo dopo consenso. Per misurare l\u2019efficacia delle campagne pubblicitarie e per il remarketing.',
      pt: 'Meta Pixel (Facebook/Instagram). Carregado apenas ap\u00f3s consentimento. Para medir o desempenho dos an\u00fancios e remarketing.'
    },
    save: {
      en: 'Save preferences',
      it: 'Salva preferenze',
      pt: 'Salvar prefer\u00eancias'
    },
    moreInfo: {
      en: 'Read our Cookie Policy',
      it: 'Leggi la nostra Cookie Policy',
      pt: 'Leia nossa Pol\u00edtica de Cookies'
    }
  };

  function t(key) {
    var lang = (typeof currentLang === 'string' && i18n[key][currentLang]) ? currentLang : 'en';
    return i18n[key][lang];
  }

  var styleInjected = false;
  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    var css = [
      '.hu-cc-banner{position:fixed;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;',
      'background:#fff;color:#1a1a1a;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.22);',
      'padding:22px 22px 18px;font-family:inherit;z-index:9999;line-height:1.45;font-size:14.5px;',
      'animation:hu-cc-slide .35s ease-out both}',
      '@keyframes hu-cc-slide{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}',
      '.hu-cc-banner h3{margin:0 0 8px 0;font-size:17px;font-weight:600;color:#7B2252}',
      '.hu-cc-banner p{margin:0 0 14px 0;color:#333}',
      '.hu-cc-banner a{color:#7B2252;text-decoration:underline}',
      '.hu-cc-actions{display:flex;flex-wrap:wrap;gap:8px}',
      '.hu-cc-actions button{border:none;cursor:pointer;padding:10px 16px;border-radius:10px;',
      'font-weight:600;font-size:14px;transition:opacity .15s}',
      '.hu-cc-actions button:hover{opacity:.88}',
      '.hu-cc-primary{background:#7B2252;color:#fff}',
      '.hu-cc-secondary{background:#f4ecf1;color:#7B2252}',
      '.hu-cc-link{background:transparent;color:#7B2252;text-decoration:underline;padding-left:4px!important;padding-right:4px!important}',
      '.hu-cc-details{display:none;margin-top:14px;border-top:1px solid #ecdde5;padding-top:14px}',
      '.hu-cc-details.hu-cc-open{display:block}',
      '.hu-cc-row{display:flex;gap:10px;margin-bottom:12px;align-items:flex-start}',
      '.hu-cc-row input[type=checkbox]{margin-top:3px;accent-color:#7B2252;width:16px;height:16px;flex-shrink:0}',
      '.hu-cc-row label{font-weight:600;display:block;margin-bottom:2px}',
      '.hu-cc-row small{display:block;color:#666;font-weight:400;font-size:12.5px;line-height:1.4}',
      '@media (max-width:600px){.hu-cc-banner{left:8px;right:8px;bottom:8px;padding:18px 18px 14px}',
      '.hu-cc-actions button{flex:1 1 auto;min-width:120px}}'
    ].join('');
    var s = document.createElement('style');
    s.setAttribute('data-hu-cookie-banner', '1');
    s.textContent = css;
    document.head.appendChild(s);
  }

  function buildBanner() {
    injectStyles();
    var b = document.createElement('div');
    b.className = 'hu-cc-banner';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Cookie consent');
    b.innerHTML =
      '<h3>' + t('heading') + '</h3>' +
      '<p>' + t('body') + ' <a href="cookie-policy.html">' + t('moreInfo') + '</a></p>' +
      '<div class="hu-cc-actions">' +
        '<button type="button" class="hu-cc-primary" data-hu-cc="accept-all">' + t('acceptAll') + '</button>' +
        '<button type="button" class="hu-cc-secondary" data-hu-cc="reject">' + t('rejectAll') + '</button>' +
        '<button type="button" class="hu-cc-link" data-hu-cc="toggle-details">' + t('customize') + '</button>' +
      '</div>' +
      '<div class="hu-cc-details" data-hu-cc-details>' +
        '<div class="hu-cc-row">' +
          '<input type="checkbox" checked disabled>' +
          '<div><label>' + t('essentialLabel') + '</label><small>' + t('essentialDesc') + '</small></div>' +
        '</div>' +
        '<div class="hu-cc-row">' +
          '<input type="checkbox" data-hu-cc-cat="analytics">' +
          '<div><label>' + t('analyticsLabel') + '</label><small>' + t('analyticsDesc') + '</small></div>' +
        '</div>' +
        '<div class="hu-cc-row">' +
          '<input type="checkbox" data-hu-cc-cat="marketing">' +
          '<div><label>' + t('marketingLabel') + '</label><small>' + t('marketingDesc') + '</small></div>' +
        '</div>' +
        '<div class="hu-cc-actions" style="margin-top:6px">' +
          '<button type="button" class="hu-cc-primary" data-hu-cc="save">' + t('save') + '</button>' +
        '</div>' +
      '</div>';
    return b;
  }

  var bannerEl = null;

  function closeBanner() {
    if (bannerEl && bannerEl.parentNode) {
      bannerEl.parentNode.removeChild(bannerEl);
      bannerEl = null;
    }
  }

  function showBanner(existing) {
    closeBanner();
    bannerEl = buildBanner();
    // Pre-fill checkboxes if reopening after a prior choice
    if (existing) {
      var aCheck = bannerEl.querySelector('[data-hu-cc-cat="analytics"]');
      var mCheck = bannerEl.querySelector('[data-hu-cc-cat="marketing"]');
      if (aCheck) aCheck.checked = !!existing.analytics;
      if (mCheck) mCheck.checked = !!existing.marketing;
    }
    document.body.appendChild(bannerEl);
    bannerEl.addEventListener('click', function(e) {
      var t = e.target;
      var act = t.getAttribute && t.getAttribute('data-hu-cc');
      if (!act) return;
      if (act === 'accept-all') {
        saveConsent({ analytics: true, marketing: true });
        loadGoogleAnalytics();
        loadMetaPixel();
        closeBanner();
      } else if (act === 'reject') {
        saveConsent({ analytics: false, marketing: false });
        closeBanner();
      } else if (act === 'toggle-details') {
        var details = bannerEl.querySelector('[data-hu-cc-details]');
        if (details) details.classList.toggle('hu-cc-open');
      } else if (act === 'save') {
        var a = bannerEl.querySelector('[data-hu-cc-cat="analytics"]');
        var m = bannerEl.querySelector('[data-hu-cc-cat="marketing"]');
        var analytics = a && a.checked;
        var marketing = m && m.checked;
        saveConsent({ analytics: analytics, marketing: marketing });
        if (analytics) loadGoogleAnalytics();
        if (marketing) loadMetaPixel();
        closeBanner();
      }
    });
  }

  // Public API — wire into footer "Cookie Settings" link.
  window.huOpenCookieSettings = function() {
    showBanner(getConsent());
  };

  // On page load: show banner if no decision yet, otherwise honour it.
  document.addEventListener('DOMContentLoaded', function() {
    var consent = getConsent();
    if (consent === null) {
      showBanner(null);
      return;
    }
    if (consent.analytics) loadGoogleAnalytics();
    if (consent.marketing) loadMetaPixel();
  });
})();
