function initCloseButton() {
  const closeBtn = document.getElementById("close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => window.close());
  }
}

function applyLanguage(lang) {
  const nodes = document.querySelectorAll("[data-i18n]");
  for (const node of nodes) {
    const value = node.getAttribute(`data-${lang}`);
    const mode = node.getAttribute("data-i18n");
    if (!value) continue;
    if (mode === "html") {
      node.innerHTML = value;
    } else {
      node.textContent = value;
    }
  }

  document.documentElement.lang = lang;

  const enBtn = document.getElementById("lang-en");
  const zhBtn = document.getElementById("lang-zh");
  enBtn?.classList.toggle("is-active", lang === "en");
  zhBtn?.classList.toggle("is-active", lang === "zh");

  try {
    localStorage.setItem("browseraide_help_lang", lang);
  } catch (_error) {
    // Ignore storage errors in restricted extension contexts.
  }
}

function initLanguageSwitch() {
  const enBtn = document.getElementById("lang-en");
  const zhBtn = document.getElementById("lang-zh");

  enBtn?.addEventListener("click", () => applyLanguage("en"));
  zhBtn?.addEventListener("click", () => applyLanguage("zh"));

  let lang = "en";
  try {
    const saved = localStorage.getItem("browseraide_help_lang");
    if (saved === "zh" || saved === "en") {
      lang = saved;
    }
  } catch (_error) {
    // Fall back to English by default.
  }

  applyLanguage(lang);
}

function initScrollReveal() {
  const items = document.querySelectorAll(".section-block, .footer-panel");

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    items.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  items.forEach((item) => item.classList.add("reveal"));

  if (!("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.16 });

  items.forEach((item) => observer.observe(item));
}

document.addEventListener("DOMContentLoaded", () => {
  initCloseButton();
  initLanguageSwitch();
  initScrollReveal();
});
