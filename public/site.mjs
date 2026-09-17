// Shared by every page: the EN / ID toggle. Static copy is written twice in
// the HTML as lang="en" / lang="id" spans and CSS shows one set; pages with
// dynamic text pass an onChange to re-render it.
export function initLang(onChange) {
  let lang = 'en';
  try {
    const saved = localStorage.getItem('transitlab.lang');
    lang = saved === 'id' || saved === 'en' ? saved : navigator.language.startsWith('id') ? 'id' : 'en';
  } catch { /* storage unavailable */ }
  const apply = l => {
    lang = l;
    document.documentElement.lang = l;
    document.documentElement.dataset.lang = l;
    for (const b of document.querySelectorAll('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === l));
    try { localStorage.setItem('transitlab.lang', l); } catch { /* ignore */ }
    onChange?.(l);
  };
  for (const b of document.querySelectorAll('.lang button')) b.addEventListener('click', () => apply(b.dataset.lang));
  apply(lang);
  return () => lang;
}
