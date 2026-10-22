const root = document.documentElement;
const media = matchMedia('(prefers-color-scheme: dark)');
const themeSelect = document.querySelector('[data-theme-select]');
const menuButton = document.querySelector('[data-open-menu]');
const closeButtons = document.querySelectorAll('[data-close-menu]');

function applyTheme(preference) {
  root.dataset.themePreference = preference;
  root.dataset.theme = preference === 'auto' ? (media.matches ? 'dark' : 'light') : preference;
  if (themeSelect) themeSelect.value = preference;
}

applyTheme(root.dataset.themePreference || 'auto');
themeSelect?.addEventListener('change', () => {
  const preference = themeSelect.value;
  applyTheme(preference);
  try { localStorage.setItem('linfa-docs-theme-preference', preference); } catch (_) { /* Storage is optional. */ }
});
media.addEventListener('change', () => {
  if (root.dataset.themePreference === 'auto') applyTheme('auto');
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
document.querySelectorAll('.chapter-nav a, .sidebar-extra').forEach(link => {
  link.addEventListener('click', () => {
    if (document.body.classList.contains('menu-open')) setMenuOpen(false);
  });
});

const tocLinks = Array.from(document.querySelectorAll('.page-toc a'));
if ('IntersectionObserver' in window && tocLinks.length) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      tocLinks.forEach(link => link.classList.toggle('is-current', link.hash === `#${entry.target.id}`));
    }
  }, { rootMargin: '-15% 0px -70% 0px' });
  document.querySelectorAll('.markdown-body h2[id]').forEach(section => observer.observe(section));
}

function highlightValuesToCheck(code) {
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    const parts = node.textContent.split(/(<[A-Z][A-Z0-9_]*>|\/dev\/tty(?:USB|ACM)\d+)/g);
    if (parts.length === 1) continue;

    const fragment = document.createDocumentFragment();
    parts.forEach((part, index) => {
      if (!part) return;
      if (index % 2 === 0) {
        fragment.append(document.createTextNode(part));
      } else {
        const marker = document.createElement('span');
        marker.className = 'value-to-check';
        marker.textContent = part;
        fragment.append(marker);
      }
    });
    node.replaceWith(fragment);
  }
}

document.querySelectorAll('.markdown-body code').forEach(highlightValuesToCheck);

document.querySelectorAll('.markdown-body .highlight').forEach(block => {
  const header = block.querySelector(':scope > .code-header');
  if (header) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-code';
  button.textContent = 'Copia';
  button.setAttribute('aria-label', 'Copia il blocco di codice');
  block.append(button);
  button.addEventListener('click', async () => {
    const code = block.querySelector('code')?.textContent || '';
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = 'Copiato';
    } catch (_) {
      button.textContent = 'Seleziona e copia';
    }
    window.setTimeout(() => { button.textContent = 'Copia'; }, 2000);
  });
});
