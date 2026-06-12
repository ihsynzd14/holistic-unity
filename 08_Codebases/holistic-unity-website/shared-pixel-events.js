/* ═══════════════════════════════════════════════════════════
   Holistic Unity — Meta Pixel custom events
   Pixel ID: 1445760663897743
   Eventi: Lead, ViewContent, Contact, Search, CompleteRegistration
═══════════════════════════════════════════════════════════ */
(function () {
  if (typeof fbq === 'undefined') {
    console.warn('[HU Pixel] fbq non caricato, eventi disabilitati');
    return;
  }

  function track(event, params) {
    try {
      fbq('track', event, params || {});
    } catch (err) {
      console.warn('[HU Pixel] Errore tracking', event, err);
    }
  }

  function trackCustom(event, params) {
    try {
      fbq('trackCustom', event, params || {});
    } catch (err) {}
  }

  /* ════════ ViewContent per pagina terapia / blog ════════ */
  const disciplineMap = {
    '/thetahealing.html': 'ThetaHealing',
    '/reiki.html': 'Reiki',
    '/astrology.html': 'Astrologia',
    '/human-design.html': 'Human Design',
    '/numerology.html': 'Numerologia',
    '/ayurveda.html': 'Ayurveda',
    '/naturopathy.html': 'Naturopatia',
    '/family-constellation.html': 'Costellazioni Familiari',
    '/systemic-constellation.html': 'Costellazioni Sistemiche'
  };

  const path = window.location.pathname;

  if (disciplineMap[path]) {
    track('ViewContent', {
      content_name: disciplineMap[path],
      content_category: 'Therapy Discipline',
      content_type: 'service'
    });
  } else if (
    path.startsWith('/blog/') &&
    path !== '/blog/' &&
    path !== '/blog/index.html'
  ) {
    const slug = path.replace('/blog/', '').replace('.html', '');
    track('ViewContent', {
      content_name: slug,
      content_category: 'Blog Article',
      content_type: 'article'
    });
  }

  /* ════════ Click-based events ════════ */
  document.addEventListener(
    'click',
    function (e) {
      const el = e.target.closest('a, button');
      if (!el) return;

      const text = (el.innerText || el.textContent || '').toLowerCase().trim();
      const href = el.getAttribute('href') || '';

      /* ── Lead: intenzione di prenotare ── */
      const leadPatterns = [
        'chiamata gratuita',
        'prenota chiamata',
        'prenota ora',
        'prenota una sessione',
        'prenota sessione',
        'inizia ora',
        "inizia il tuo",
        'book a call',
        'book now',
        'book a session'
      ];
      if (leadPatterns.some((p) => text.includes(p))) {
        track('Lead', {
          content_name: text.substring(0, 80),
          content_category: 'Booking Intent',
          // Meta requires value > 0 on Lead events — a lead has no
          // price, so we send the standard placeholder of 1.
          value: 1,
          currency: 'EUR'
        });
      }

      /* ── Contact: mailto / tel / WhatsApp ── */
      if (href.startsWith('mailto:')) {
        track('Contact', {
          method: 'email',
          content_name: href.replace('mailto:', '')
        });
      } else if (href.startsWith('tel:')) {
        track('Contact', {
          method: 'phone'
        });
      } else if (
        href.includes('wa.me') ||
        href.toLowerCase().includes('whatsapp')
      ) {
        track('Contact', {
          method: 'whatsapp'
        });
      }

      /* ── Search: navigazione verso pagina disciplina ── */
      if (href) {
        for (const disciplinePath in disciplineMap) {
          if (href.endsWith(disciplinePath)) {
            track('Search', {
              search_string: disciplineMap[disciplinePath],
              content_category: 'Therapy Discipline'
            });
            break;
          }
        }
      }

      /* ── CompleteRegistration: signup terapista ── */
      if (
        text.includes('diventa terapeuta') ||
        text.includes('registrati come terapeuta') ||
        text.includes('sono un terapeuta') ||
        text.includes('become a therapist') ||
        (href.includes('therapist') && !href.includes('therapists')) ||
        href.includes('/diventa-terapeuta')
      ) {
        track('CompleteRegistration', {
          content_name: 'Therapist Signup Intent',
          content_category: 'Therapist Funnel'
        });
      }

      /* ── Custom: click su cambio lingua ── */
      if (
        el.classList &&
        (el.classList.contains('lang-btn') || el.closest('[class*="lang"]'))
      ) {
        const lang = text.toUpperCase().substring(0, 2);
        if (['EN', 'IT', 'PT'].includes(lang)) {
          trackCustom('LanguageSwitch', { language: lang });
        }
      }
    },
    { passive: true }
  );

  /* ════════ Scroll depth (custom event) ════════ */
  const scrollTracked = { 50: false, 90: false };
  let scrollTimer = null;
  window.addEventListener(
    'scroll',
    function () {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const docHeight =
          document.documentElement.scrollHeight - window.innerHeight;
        if (docHeight <= 0) return;
        const percent = Math.round((scrollTop / docHeight) * 100);
        [50, 90].forEach((threshold) => {
          if (percent >= threshold && !scrollTracked[threshold]) {
            scrollTracked[threshold] = true;
            trackCustom('ScrollDepth', { depth: threshold });
          }
        });
      }, 250);
    },
    { passive: true }
  );

  /* ════════ Time-on-page (custom, 60 secondi) ════════ */
  setTimeout(function () {
    trackCustom('EngagedSession', { seconds: 60 });
  }, 60000);
})();
