const root = document.documentElement;
const themeButton = document.querySelector('[data-theme-toggle]');
const menuButton = document.querySelector('[data-open-menu]');
const closeButtons = document.querySelectorAll('[data-close-menu]');

function updateThemeLabel() {
  themeButton?.setAttribute(
    'aria-label',
    root.dataset.theme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'
  );
}

updateThemeLabel();
themeButton?.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('linfa-docs-theme', root.dataset.theme); } catch (_) { /* Storage optional. */ }
  updateThemeLabel();
});

function setMenuOpen(open) {
  document.body.classList.toggle('menu-open', open);
  menuButton?.setAttribute('aria-expanded', String(open));
  if (open) document.querySelector('.sidebar-close')?.focus();
  else menuButton?.focus();
}

menuButton?.addEventListener('click', () => setMenuOpen(true));
closeButtons.forEach(button => button.addEventListener('click', () => setMenuOpen(false)));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('menu-open')) setMenuOpen(false);
});
document.querySelectorAll('.chapter-nav a').forEach(link => {
  link.addEventListener('click', () => {
    if (document.body.classList.contains('menu-open')) setMenuOpen(false);
  });
});

const copyButton = document.querySelector('[data-copy-code]');
copyButton?.addEventListener('click', async () => {
  const command = document.querySelector('.code-card code')?.textContent || '';
  try {
    await navigator.clipboard.writeText(command);
    copyButton.textContent = 'Copiato';
    window.setTimeout(() => { copyButton.textContent = 'Copia'; }, 1800);
  } catch (_) {
    copyButton.textContent = 'Seleziona il comando';
    window.setTimeout(() => { copyButton.textContent = 'Copia'; }, 2500);
  }
});

const tocLinks = Array.from(document.querySelectorAll('.page-toc a'));
if ('IntersectionObserver' in window && tocLinks.length) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      tocLinks.forEach(link => link.classList.toggle('is-current', link.hash === `#${entry.target.id}`));
    }
  }, { rootMargin: '-15% 0px -70% 0px' });
  document.querySelectorAll('.article-section[id]').forEach(section => observer.observe(section));
}
