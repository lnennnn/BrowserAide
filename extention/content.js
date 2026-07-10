

const Config = {

  INDICATOR_DURATION: 800,
  SCROLL_RATIO: 0.8,
  NEARBY_INPUT_RADIUS: 100,


  SCROLL_WAIT: 100,
  TYPE_WAIT: 30,
  FOCUS_WAIT: 30,
  SUBMIT_WAIT: 50,


  COLOR_CLICK: "#3b82f6",
  COLOR_TYPE: "#8b5cf6",
  COLOR_DOM: "#10b981",
  COLOR_HYBRID: "#f59e0b",


  MAX_DOM_ELEMENTS: 80,
  DOM_TEXT_MAX_LENGTH: 100,


  EXTRACT_TEXT_MAX_LENGTH: 16000,
};


let extractedPageText = null;


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    "PING": () => ({ ok: true, version: "three-mode" }),

    "GET_PAGE_INFO": () => getPageInfo(),


    "GET_PAGE_STATE": () => getPageState(),


    "GET_ELEMENT_CENTER": () => getElementCenter(message.index),


    "GET_DOM_ELEMENTS": () => extractDOMElements(),

    "EXECUTE_ACTION": async () => {
      return await executeAction(message.action, message.viewport);
    },

    "SHOW_USER_NOTIFICATION": () => {
      showUserNotification(message.reason);
      return { ok: true };
    },

    "HIDE_USER_NOTIFICATION": () => {
      hideUserNotification();
      return { ok: true };
    },


    "SHOW_CLICK_INDICATOR": () => {
      showClickIndicator(message.x, message.y, message.mode || "click");
      return { ok: true };
    },


    "HIGHLIGHT_ELEMENT": () => {
      highlightElement(message.selector, message.index);
      return { ok: true };
    }
  };

  const handler = handlers[message.type];

  if (!handler) {
    sendResponse({ ok: false, error: "Unknown message type" });
    return;
  }


  const result = handler();

  if (result instanceof Promise) {
    result
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  sendResponse(result);
});


function getPageInfo() {

  const verticalContainer = findScrollableContainer('vertical');
  const horizontalContainer = findScrollableContainer('horizontal');

  let scrollInfo;


  if (verticalContainer) {
    scrollInfo = {
      y: verticalContainer.scrollTop,
      total: verticalContainer.scrollHeight,
      viewport: verticalContainer.clientHeight,
      containerType: 'custom'
    };
  } else {
    scrollInfo = {
      y: window.scrollY,
      total: document.documentElement.scrollHeight,
      viewport: window.innerHeight,
      containerType: 'window'
    };
  }


  if (horizontalContainer) {
    scrollInfo.x = horizontalContainer.scrollLeft;
    scrollInfo.totalWidth = horizontalContainer.scrollWidth;
    scrollInfo.viewportWidth = horizontalContainer.clientWidth;
    scrollInfo.horizontalContainerType = 'custom';
  } else {
    scrollInfo.x = window.scrollX;
    scrollInfo.totalWidth = document.documentElement.scrollWidth;
    scrollInfo.viewportWidth = window.innerWidth;
    scrollInfo.horizontalContainerType = 'window';
  }


  const pageText = extractedPageText;
  extractedPageText = null;

  return {

    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,


    scroll: scrollInfo,


    url: window.location.href,
    title: document.title,


    extractedText: pageText
  };
}


function getPageState() {

  const interactiveCount = document.querySelectorAll(
    'a, button, input, textarea, select, [onclick], [role="button"]'
  ).length;


  const scrollContainer = findScrollableContainer();
  const scrollY = scrollContainer ? scrollContainer.scrollTop : window.scrollY;


  return {
    url: window.location.href,
    scrollY: Math.round(scrollY),
    interactiveCount: interactiveCount,
    readyState: document.readyState

  };
}


function getElementCenter(index) {
  if (index === undefined || index === null) {
    return null;
  }


  if (!window.__domElementsCache || !window.__domElementsCache[index]) {

    extractDOMElements();
  }

  const elementInfo = window.__domElementsCache?.[index];
  if (!elementInfo || !elementInfo.element) {
    console.warn(`[Agent] getElementCenter: element not found at index ${index}`);
    return null;
  }

  const element = elementInfo.element;
  const rect = element.getBoundingClientRect();

  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}


function extractDOMElements() {
  const elements = [];
  const elementsCache = [];


  const selectors = [

    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    'summary',
    'label[for]',
    '[contenteditable="true"]',
    '[onclick]',


    '[role="button"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="gridcell"]',
    '[role="switch"]',
    '[role="slider"]',
    '[role="treeitem"]',
    '[role="combobox"]',


    '[tabindex]:not([tabindex="-1"])',
  ];


  const allElements = document.querySelectorAll(selectors.join(', '));


  const seen = new Set();
  let index = 0;

  for (const el of allElements) {
    if (seen.has(el)) continue;
    seen.add(el);


    if (!isElementVisible(el)) continue;


    if (el.disabled) continue;


    const info = extractElementInfo(el, index);
    if (info) {
      elements.push(info);

      elementsCache[index] = { element: el, info: info };
      index++;
    }


    if (index >= Config.MAX_DOM_ELEMENTS) break;
  }


  if (index < Config.MAX_DOM_ELEMENTS) {
    const candidateTags = ['td', 'div', 'span', 'li'];
    for (const tag of candidateTags) {
      const tagElements = document.querySelectorAll(tag);
      for (const el of tagElements) {
        if (seen.has(el)) continue;
        if (!isElementVisible(el)) continue;
        if (el.disabled) continue;


        const style = getComputedStyle(el);
        const isCursorPointer = style.cursor === 'pointer';
        const hasClickData = el.hasAttribute('data-date') ||
                             el.hasAttribute('data-value') ||
                             el.hasAttribute('data-day');

        if (!isCursorPointer && !hasClickData) continue;


        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) continue;
        if (rect.width > 300 || rect.height > 200) continue;

        seen.add(el);
        const info = extractElementInfo(el, index);
        if (info) {
          elements.push(info);
          elementsCache[index] = { element: el, info: info };
          index++;
        }

        if (index >= Config.MAX_DOM_ELEMENTS) break;
      }
      if (index >= Config.MAX_DOM_ELEMENTS) break;
    }
  }


  window.__domElementsCache = elementsCache;

  console.log(`[Agent DOM] Extracted ${elements.length} interactive elements`);

  return {
    elements: elements,
    count: elements.length
  };
}

function extractElementInfo(el, index) {
  const rect = el.getBoundingClientRect();


  if (rect.width === 0 || rect.height === 0) return null;

  const tag = el.tagName.toLowerCase();


  let text = getElementText(el);
  if (text.length > Config.DOM_TEXT_MAX_LENGTH) {
    text = text.substring(0, Config.DOM_TEXT_MAX_LENGTH) + '...';
  }


  const selector = generateUniqueSelector(el);


  const context = getElementContext(el);

  return {
    index: index,
    tag: tag,
    text: text,
    context: context,
    role: el.getAttribute('role') || '',
    type: el.type || '',
    name: el.name || '',
    id: el.id || '',
    className: el.className || '',
    placeholder: el.placeholder || '',
    value: (tag === 'input' || tag === 'textarea') ? (el.value || '') : '',
    href: (tag === 'a') ? el.href : '',
    selector: selector,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    }
  };
}

function getElementText(el) {

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();


  if (el.title) return el.title.trim();


  if (el.placeholder) return el.placeholder.trim();


  if (el.value && el.type !== 'text' && el.type !== 'password') {
    return el.value.trim();
  }


  const text = el.innerText || el.textContent || '';
  return text.trim().replace(/\s+/g, ' ');
}

function getElementContext(el) {
  const contexts = [];


  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) {
      const labelText = (label.innerText || label.textContent || '').trim();
      if (labelText) {
        contexts.push(`label: "${labelText}"`);
      }
    }
  }


  const parentLabel = el.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    const inputs = clone.querySelectorAll('input, select, textarea');
    inputs.forEach(i => i.remove());
    const labelText = (clone.innerText || clone.textContent || '').trim();
    if (labelText && !contexts.some(c => c.includes(labelText))) {
      contexts.push(`label: "${labelText}"`);
    }
  }


  const prevText = getPreviousSiblingText(el);
  if (prevText && prevText.length > 0 && prevText.length < 50) {
    if (!contexts.some(c => c.includes(prevText))) {
      contexts.push(`before: "${prevText}"`);
    }
  }


  const fieldset = el.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend) {
      const legendText = (legend.innerText || legend.textContent || '').trim();
      if (legendText) {
        contexts.push(`group: "${legendText}"`);
      }
    }
  }


  const container = el.closest('div, section, article, form');
  if (container) {
    const heading = container.querySelector('h1, h2, h3, h4, h5, h6, .title, .header, .label');
    if (heading && container.contains(heading) && !heading.contains(el)) {
      const headingText = (heading.innerText || heading.textContent || '').trim();
      if (headingText && headingText.length < 50 && !contexts.some(c => c.includes(headingText))) {
        contexts.push(`section: "${headingText}"`);
      }
    }
  }


  if (el.name) {
    const name = el.name.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    if (name.length > 2 && name.length < 30 && !/^\d+$/.test(name)) {
      contexts.push(`name: "${name}"`);
    }
  }


  const form = el.closest('form');
  if (form) {
    const formInputs = form.querySelectorAll('input:not([type="hidden"]), select, textarea');
    const inputIndex = Array.from(formInputs).indexOf(el);
    if (inputIndex >= 0 && formInputs.length > 1) {
      contexts.push(`form input ${inputIndex + 1}/${formInputs.length}`);
    }
  }


  if (contexts.length === 0) {
    const nearbyText = findNearbyText(el);
    if (nearbyText) {
      contexts.push(`near: "${nearbyText}"`);
    }
  }


  if (contexts.length === 0) {
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    let vPos = 'middle';
    if (rect.top < viewportHeight * 0.33) vPos = 'top';
    else if (rect.top > viewportHeight * 0.66) vPos = 'bottom';

    let hPos = 'center';
    if (rect.left < viewportWidth * 0.33) hPos = 'left';
    else if (rect.left > viewportWidth * 0.66) hPos = 'right';

    contexts.push(`position: ${vPos}-${hPos}`);
    contexts.push(`y: ${Math.round(rect.top)}px`);
  }

  return contexts.join(', ');
}

function getPreviousSiblingText(el) {
  let prev = el.previousElementSibling;

  while (prev && window.getComputedStyle(prev).display === 'none') {
    prev = prev.previousElementSibling;
  }

  if (prev) {
    const text = (prev.innerText || prev.textContent || '').trim();
    if (text) return text;
  }

  let node = el.previousSibling;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text) return text;
    }
    node = node.previousSibling;
  }

  return '';
}

function findNearbyText(el) {
  let parent = el.parentElement;
  let depth = 0;

  while (parent && depth < 3) {
    for (const sibling of parent.children) {
      if (sibling === el || sibling.contains(el)) continue;

      const tag = sibling.tagName.toLowerCase();
      if (['input', 'select', 'textarea', 'button', 'script', 'style'].includes(tag)) continue;

      const text = (sibling.innerText || sibling.textContent || '').trim();

      if (text && text.length > 1 && text.length < 40 && !text.includes('\n')) {
        return text;
      }
    }

    for (const node of parent.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text && text.length > 1 && text.length < 40) {
          return text;
        }
      }
    }

    parent = parent.parentElement;
    depth++;
  }

  return '';
}

function generateUniqueSelector(el) {

  if (el.id) {
    const idSelector = `#${CSS.escape(el.id)}`;
    if (document.querySelectorAll(idSelector).length === 1) {
      return idSelector;
    }
  }


  if (el.name) {
    const selector = `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }


  const path = [];
  let current = el;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();


    if (current.id) {
      const idSelector = `#${CSS.escape(current.id)}`;
      if (document.querySelectorAll(idSelector).length === 1) {
        path.unshift(idSelector);
        break;
      }
    }


    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(c =>
        c && !c.startsWith('ng-') && !c.startsWith('v-') && c.length < 30
      );
      if (classes.length > 0) {
        selector += `.${CSS.escape(classes[0])}`;
      }
    }


    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        c => c.tagName === current.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(' > ');
}

function isElementVisible(el) {
  const rect = el.getBoundingClientRect();
  let current = el;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const style = window.getComputedStyle(current);
    if (current.hidden) return false;
    if (current.getAttribute('aria-hidden') === 'true') return false;
    if (current.inert) return false;
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    current = current.parentElement;
  }


  if (rect.width === 0 && rect.height === 0) return false;


  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;


  const margin = 100;
  if (rect.bottom < -margin) return false;
  if (rect.top > viewportHeight + margin) return false;
  if (rect.right < -margin) return false;
  if (rect.left > viewportWidth + margin) return false;

  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  if (
    centerX >= 0 &&
    centerY >= 0 &&
    centerX <= viewportWidth &&
    centerY <= viewportHeight
  ) {
    const topElement = document.elementFromPoint(centerX, centerY);
    if (topElement && topElement !== el && !el.contains(topElement) && !topElement.contains(el)) {
      return false;
    }
  }

  return true;
}

function highlightElement(selector, index) {

  document.querySelectorAll('.browseraide-highlight').forEach(el => el.remove());

  let element = null;

  if (selector) {
    element = document.querySelector(selector);
  } else if (typeof index === 'number') {

    const { elements } = extractDOMElements();
    if (elements[index]) {
      element = document.querySelector(elements[index].selector);
    }
  }

  if (!element) return;

  const rect = element.getBoundingClientRect();

  const highlight = document.createElement('div');
  highlight.className = 'browseraide-highlight';
  highlight.style.cssText = `
    position: fixed;
    left: ${rect.x - 2}px;
    top: ${rect.y - 2}px;
    width: ${rect.width + 4}px;
    height: ${rect.height + 4}px;
    border: 2px solid ${Config.COLOR_DOM};
    background: rgba(16, 185, 129, 0.1);
    pointer-events: none;
    z-index: 2147483646;
    border-radius: 4px;
    animation: browseraide-highlight-pulse 1s ease-in-out infinite;
  `;

  ensureHighlightStyles();
  document.body.appendChild(highlight);


  setTimeout(() => highlight.remove(), 3000);
}

function ensureHighlightStyles() {
  if (document.getElementById('browseraide-highlight-styles')) return;

  const style = document.createElement('style');
  style.id = 'browseraide-highlight-styles';
  style.textContent = `
    @keyframes browseraide-highlight-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `;
  document.head.appendChild(style);
}


async function executeAction(action, viewport) {
  const type = action.action_type.toLowerCase();
  const inputs = action.action_inputs || {};

  const vw = viewport?.width || document.documentElement.clientWidth;
  const vh = viewport?.height || document.documentElement.clientHeight;

  console.log(`[Agent Execute] ${type}`, inputs);


  const actionHandlers = {

    "click":        () => handleClick(inputs, vw, vh),
    "type":         () => handleType(inputs, vw, vh),
    "hover":        () => handleHover(inputs, vw, vh),


    "dom_click":    () => handleDOMClick(inputs),
    "dom_type":     () => handleDOMType(inputs),
    "dom_select":   () => handleDOMSelect(inputs),
    "dom_hover":    () => handleDOMHover(inputs),


    "scroll":       () => handleScroll(inputs),
    "goto":         () => handleGoto(inputs),
    "back":         () => window.history.back(),
    "wait":         () => handleWait(inputs),
    "new_tab":      () => console.log("[Agent] new_tab should be handled by background"),
    "extract_page_text": () => handleExtractText(),
    "extract_text": () => handleExtractText(),
  };

  const handler = actionHandlers[type];

  if (handler) {
    const result = await handler();
    return result || { ok: true, action_type: type };
  } else {
    throw new Error(`Unknown action: ${type}`);
  }
}


async function handleClick(inputs, vw, vh) {
  const coords = inputs.start_box_coords;

  if (!coords || coords.length < 2) {
    throw new Error("Click: missing coordinates");
  }

  const [x, y] = coords;
  console.log(`[Agent Click] Coords: (${x.toFixed(1)}, ${y.toFixed(1)})`);


  showClickIndicator(x, y, "click");


  let element = document.elementFromPoint(x, y);

  if (element) {
    console.log(`[Agent Click] Target: <${element.tagName.toLowerCase()}> .${element.className}`);

    let clickX = x, clickY = y;
    let refined = false;


    const refinedTarget = refineGridLikeClickTarget(x, y, element);
    if (refinedTarget) {
      element = refinedTarget.element;
      clickX = refinedTarget.x;
      clickY = refinedTarget.y;
      refined = true;
      console.log(
        `[Agent Click] Grid target refined: (${clickX.toFixed(1)}, ${clickY.toFixed(1)}), samples=${refinedTarget.hits}`
      );
    }


    if (!refined && !findClickableElement(element)) {
      const nearby = findNearbyClickableElement(x, y);
      if (nearby) {
        element = nearby.element;
        clickX = nearby.x;
        clickY = nearby.y;
        console.log(
          `[Agent Click] Nearby clickable found: <${element.tagName.toLowerCase()}> at (${clickX.toFixed(1)}, ${clickY.toFixed(1)}), dist=${nearby.dist.toFixed(1)}px`
        );
      }
    }


    const tag = element.tagName.toLowerCase();
    const isFocusable = ['input', 'textarea', 'select', 'button', 'a'].includes(tag)
                        || element.hasAttribute('tabindex');
    if (isFocusable) {
      element.focus();
    }
    await enhancedClick(element, clickX, clickY);
  } else {

    console.log("[Agent Click] No element at point, dispatching on body");
    dispatchMouseEvents(document.body, x, y, ['mouseover', 'mouseenter', 'mousemove']);
    dispatchMouseEvents(document.body, x, y, ['mousedown']);
    await sleep(10);
    dispatchMouseEvents(document.body, x, y, ['mouseup']);
    dispatchMouseEvents(document.body, x, y, ['click']);
  }
}


async function handleHover(inputs, vw, vh) {
  const coords = inputs.start_box_coords;

  if (!coords || coords.length < 2) {
    throw new Error("Hover: missing coordinates");
  }

  const [x, y] = coords;
  console.log(`[Agent Hover] (${x.toFixed(1)}, ${y.toFixed(1)})`);


  showClickIndicator(x, y, "hover");


  const element = document.elementFromPoint(x, y);

  if (element) {
    console.log(`[Agent Hover] Target: <${element.tagName.toLowerCase()}> .${element.className}`);


    const needsScroll = !isElementInViewport(element);


    scrollIntoViewIfNeeded(element);
    await sleep(Config.FOCUS_WAIT);


    const rect = element.getBoundingClientRect();
    const actualX = rect.left + rect.width / 2;
    const actualY = rect.top + rect.height / 2;

    if (needsScroll) {
      console.log(`[Agent Hover] After scroll, actual coords: (${actualX.toFixed(1)}, ${actualY.toFixed(1)})`);
    }


    dispatchHoverEvents(element, actualX, actualY);
  } else {
    console.log("[Agent Hover] No element at point");
    dispatchHoverEvents(document.body, x, y);
  }
}

function dispatchHoverEvents(element, x, y) {
  const screenX = window.screenX + x;
  const screenY = window.screenY + y;

  const commonOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    screenX: screenX,
    screenY: screenY,
    clientX: x,
    clientY: y,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false
  };


  if (typeof PointerEvent !== 'undefined') {
    const pointerOptions = {
      ...commonOptions,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      width: 1,
      height: 1,
      pressure: 0,
      tiltX: 0,
      tiltY: 0
    };

    element.dispatchEvent(new PointerEvent('pointerover', pointerOptions));
    element.dispatchEvent(new PointerEvent('pointerenter', { ...pointerOptions, bubbles: false }));
    element.dispatchEvent(new PointerEvent('pointermove', pointerOptions));
  }


  const mouseOptions = {
    ...commonOptions,
    button: 0,
    buttons: 0,
    relatedTarget: null
  };

  element.dispatchEvent(new MouseEvent('mouseover', mouseOptions));
  element.dispatchEvent(new MouseEvent('mouseenter', { ...mouseOptions, bubbles: false }));
  element.dispatchEvent(new MouseEvent('mousemove', mouseOptions));


  if (element.focus && typeof element.focus === 'function') {
    try {
      element.focus({ preventScroll: true });
    } catch (e) {

    }
  }

  console.log(`[Agent Hover] Events dispatched: pointer + mouse + focus`);
}


async function handleType(inputs, vw, vh) {
  const coords = inputs.start_box_coords;
  const text = inputs.content || "";

  if (!coords || coords.length < 2) {
    throw new Error("Type: missing coordinates");
  }

  const [x, y] = coords;
  console.log(`[Agent Type] "${text}" at (${x.toFixed(1)}, ${y.toFixed(1)})`);


  showClickIndicator(x, y, "type");


  const element = document.elementFromPoint(x, y);
  const inputElement = await resolveTypingTarget(element, x, y);

  if (inputElement) {
    await typeIntoElement(inputElement, text);
  } else {
    throw new Error("Type: no suitable input element found");
  }
}


async function handleDOMClick(inputs) {
  const element = findDOMElement(inputs);

  if (!element) {
    throw new Error("DOM click: element not found");
  }

  console.log(`[Agent DOM Click] <${element.tagName.toLowerCase()}>`);


  showDOMClickIndicator(element, "click");


  scrollIntoViewIfNeeded(element);
  await sleep(Config.FOCUS_WAIT);


  const rect = element.getBoundingClientRect();
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;

  console.log(`[Agent DOM Click] Clicking at (${x.toFixed(1)}, ${y.toFixed(1)})`);


  element.focus();


  const originalTarget = element.getAttribute('target');
  if (element.tagName.toLowerCase() === 'a' && originalTarget === '_blank') {
    element.removeAttribute('target');
  }


  await enhancedClick(element, x, y);


  if (originalTarget !== null && !element.hasAttribute('target')) {
    element.setAttribute('target', originalTarget);
  }
}


async function handleDOMType(inputs) {
  const element = findDOMElement(inputs);
  const text = inputs.content || "";

  if (!element) {
    throw new Error("DOM type: element not found");
  }

  console.log(`[Agent DOM Type] "${text}" into <${element.tagName.toLowerCase()}>`);


  showDOMClickIndicator(element, "type");

  scrollIntoViewIfNeeded(element);
  await sleep(Config.FOCUS_WAIT);

  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const inputElement = await resolveTypingTarget(element, x, y);

  if (!inputElement) {
    throw new Error(`DOM type: no suitable input target found for <${element.tagName.toLowerCase()}>`);
  }

  await typeIntoElement(inputElement, text);
}


async function handleDOMSelect(inputs) {
  const element = findDOMElement(inputs);
  const value = inputs.value || "";

  if (!element) {
    throw new Error("DOM select: element not found");
  }

  console.log(`[Agent DOM Select] "${value}" in <${element.tagName.toLowerCase()}>`);


  showDOMClickIndicator(element, "select");


  if (element.tagName.toLowerCase() !== 'select') {
    throw new Error(`DOM select: element is not a select (${element.tagName.toLowerCase()})`);
  }


  scrollIntoViewIfNeeded(element);
  await sleep(Config.FOCUS_WAIT);

  element.focus();


  let found = false;

  for (const option of element.options) {
    if (option.value === value || option.text === value ||
        option.text.includes(value) || option.value.includes(value)) {
      element.value = option.value;
      found = true;
      break;
    }
  }

  if (!found && element.options.length > 0) {

    const lowerValue = value.toLowerCase();
    for (const option of element.options) {
      if (option.text.toLowerCase().includes(lowerValue) ||
          option.value.toLowerCase().includes(lowerValue)) {
        element.value = option.value;
        found = true;
        break;
      }
    }
  }


  if (!found) {
    console.warn(`[Agent DOM Select] No matching option found for value: "${value}"`);
    console.log(`[Agent DOM Select] Available options:`,
      Array.from(element.options).map(o => `"${o.value}" / "${o.text}"`).join(', ')
    );
    throw new Error(`DOM select: no matching option found for "${value}"`);
  }


  if (found) {
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
}


async function handleDOMHover(inputs) {
  const element = findDOMElement(inputs);

  if (!element) {
    throw new Error("DOM hover: element not found");
  }

  console.log(`[Agent DOM Hover] <${element.tagName.toLowerCase()}> ${inputs.text || ''}`);


  showDOMClickIndicator(element, "hover");


  scrollIntoViewIfNeeded(element);
  await sleep(Config.FOCUS_WAIT);


  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  console.log(`[Agent DOM Hover] Hovering at (${x.toFixed(1)}, ${y.toFixed(1)})`);


  dispatchHoverEvents(element, x, y);

  console.log("[Agent DOM Hover] Hover triggered");
}


function findDOMElement(inputs) {

  if (typeof inputs.index === 'number') {

    if (window.__domElementsCache && window.__domElementsCache[inputs.index]) {
      const cachedElement = window.__domElementsCache[inputs.index].element;
      if (cachedElement && document.contains(cachedElement)) {
        return cachedElement;
      }
    }


    const { elements } = extractDOMElements();
    if (elements[inputs.index]) {
      const selector = elements[inputs.index].selector;
      try {
        return document.querySelector(selector);
      } catch (e) {
        console.warn("[Agent DOM] Invalid selector from index:", selector);
      }
    }
  }

  if (inputs.selector) {
    try {
      const selectorMatch = document.querySelector(inputs.selector);
      if (selectorMatch) {
        return selectorMatch;
      }
    } catch (e) {
      console.warn("[Agent DOM] Invalid selector:", inputs.selector);
    }
  }

  if (inputs.element_center) {
    const [x, y] = inputs.element_center;
    return document.elementFromPoint(x, y);
  }

  return null;
}

function showDOMClickIndicator(element, actionType = "click") {
  const rect = element.getBoundingClientRect();

  const color = {
    "click": Config.COLOR_DOM,
    "type": Config.COLOR_TYPE,
    "select": Config.COLOR_HYBRID,
    "hover": Config.COLOR_CLICK
  }[actionType] || Config.COLOR_DOM;


  const highlight = document.createElement("div");
  highlight.className = "browseraide-dom-indicator";
  highlight.style.cssText = `
    position: fixed;
    left: ${rect.x - 2}px;
    top: ${rect.y - 2}px;
    width: ${rect.width + 4}px;
    height: ${rect.height + 4}px;
    border: 2px solid ${color};
    background: rgba(${hexToRgb(color)}, 0.15);
    pointer-events: none;
    z-index: 2147483647;
    border-radius: 4px;
    animation: browseraide-dom-flash 0.3s ease-out;
  `;


  const label = document.createElement("div");
  label.style.cssText = `
    position: absolute;
    left: 0;
    bottom: 100%;
    background: ${color};
    color: white;
    padding: 2px 8px;
    border-radius: 4px 4px 0 0;
    font-size: 11px;
    font-family: monospace;
    white-space: nowrap;
  `;
  label.textContent = `DOM ${actionType}`;
  highlight.appendChild(label);

  ensureDOMIndicatorStyles();
  document.body.appendChild(highlight);


  setTimeout(() => highlight.remove(), Config.INDICATOR_DURATION);
}

function ensureDOMIndicatorStyles() {
  if (document.getElementById("browseraide-dom-indicator-styles")) return;

  const style = document.createElement("style");
  style.id = "browseraide-dom-indicator-styles";
  style.textContent = `
    @keyframes browseraide-dom-flash {
      0% { opacity: 0; transform: scale(0.95); }
      50% { opacity: 1; transform: scale(1.02); }
      100% { opacity: 1; transform: scale(1); }
    }
  `;
  document.head.appendChild(style);
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : '16, 185, 129';
}

function isElementInViewport(element, margin = 50) {
  if (!element) return false;

  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  const isVerticallyVisible = (
    rect.top >= -margin &&
    rect.bottom <= viewportHeight + margin
  );

  const isHorizontallyVisible = (
    rect.left >= -margin &&
    rect.right <= viewportWidth + margin
  );

  return isVerticallyVisible && isHorizontallyVisible;
}

function scrollIntoViewIfNeeded(element) {
  if (!element) return;

  if (!isElementInViewport(element)) {
    console.log("[Agent Scroll] Element not in viewport, scrolling...");
    element.scrollIntoView({ block: "center", behavior: "instant" });
  } else {
    console.log("[Agent Scroll] Element already visible, skipping scroll");
  }
}

async function resolveTypingTarget(element, x, y) {
  if (!element) return null;

  if (isEditableInputElement(element)) {
    return element;
  }

  const nestedInput = findInputInside(element);
  if (nestedInput) {
    return nestedInput;
  }

  const nearbyInput = findNearbyInput(x, y);
  if (nearbyInput) {
    console.log("[Agent Type] Found nearby input element");
    return nearbyInput;
  }

  try {
    await enhancedClick(element, x, y);
  } catch (e) {
    console.warn("[Agent Type] Pre-click before typing failed:", e);
  }

  await sleep(Config.FOCUS_WAIT + 120);

  const activeInput = getActiveInputElement();
  if (activeInput) {
    console.log("[Agent Type] Using active input after click");
    return activeInput;
  }

  const postClickNestedInput = findInputInside(element);
  if (postClickNestedInput) {
    return postClickNestedInput;
  }

  const postClickNearbyInput = findNearbyInput(x, y, 180);
  if (postClickNearbyInput) {
    console.log("[Agent Type] Found nearby input after click");
    return postClickNearbyInput;
  }

  const visibleInput = findBestVisibleInput();
  if (visibleInput) {
    console.log("[Agent Type] Falling back to visible input");
  }
  return visibleInput;
}

function findInputInside(element) {
  if (!element || !element.querySelector) return null;
  const candidates = element.querySelectorAll(
    'input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"]'
  );
  return Array.from(candidates).find(isEditableInputElement) || null;
}

function getActiveInputElement() {
  const active = document.activeElement;
  return isEditableInputElement(active) ? active : null;
}

function findBestVisibleInput() {
  const inputs = document.querySelectorAll(
    'input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"]'
  );

  for (const input of inputs) {
    if (isElementVisible(input) && !input.disabled && !input.readOnly) {
      return input;
    }
  }

  return null;
}

function setNativeElementValue(element, value) {
  const tag = element.tagName?.toLowerCase();
  const proto = tag === 'textarea'
    ? window.HTMLTextAreaElement?.prototype
    : window.HTMLInputElement?.prototype;
  const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;

  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

function dispatchTextInputEvents(element, text, inputType = 'insertText') {
  try {
    element.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType,
      data: text
    }));
  } catch (e) {
    element.dispatchEvent(new Event('beforeinput', { bubbles: true, cancelable: true }));
  }

  try {
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      inputType,
      data: text
    }));
  } catch (e) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function getEditableValue(element) {
  if (element.value !== undefined) return element.value;
  return element.innerText || element.textContent || "";
}

async function typeIntoElement(element, text) {

  prepareElementForTyping(element);


  if (element.value !== undefined) {
    if (element.select) {
      element.select();
    }

    setNativeElementValue(element, "");
    dispatchTextInputEvents(element, "", "deleteContentBackward");
    setNativeElementValue(element, text);
    dispatchTextInputEvents(element, text, "insertText");
  } else if (element.isContentEditable || element.getAttribute("role") === "textbox") {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);

    if (!document.execCommand("insertText", false, text)) {
      element.textContent = text;
    }
    dispatchTextInputEvents(element, text, "insertText");
  }

  if (getEditableValue(element) !== text && element.value !== undefined) {
    console.warn("[Agent Type] Value verification failed, retrying with direct value setter");
    setNativeElementValue(element, text);
    dispatchTextInputEvents(element, text, "insertReplacementText");
  }

  element.dispatchEvent(new Event("change", { bubbles: true }));

  await sleep(Config.TYPE_WAIT + 100);


  const enterEventInit = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  };

  element.dispatchEvent(new KeyboardEvent("keydown", enterEventInit));
  element.dispatchEvent(new KeyboardEvent("keypress", enterEventInit));
  element.dispatchEvent(new KeyboardEvent("keyup", enterEventInit));


}

function prepareElementForTyping(element) {
  scrollIntoViewIfNeeded(element);

  try {
    element.focus();
  } catch (e) {

  }

  try {
    element.click();
  } catch (e) {

  }

  if (element.value !== undefined && element.select) {
    try {
      element.select();
    } catch (e) {

    }
    return;
  }

  if (element.isContentEditable || element.getAttribute("role") === "textbox") {
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (e) {

    }
  }
}

function findNearbySearchButton(inputElement) {

  const searchSelectors = [

    'button[type="submit"]',
    'input[type="submit"]',

    'button.search-btn',
    'button.search-button',
    'button[class*="search"]',
    '.btn-search',
    '.search-icon',
    '.search-submit',

    '.form button',
    '.search-form button',
    '[class*="SearchBtn"]',
    '[class*="searchBtn"]',
    '[class*="submit"]',

    '[role="button"][class*="search"]',
    '[aria-label*="搜索"]',
    '[aria-label*="search" i]',
    '[title*="搜索"]',
    '[title*="search" i]',

    'button svg',
    'button i[class*="search"]',
    'button i[class*="icon"]'
  ];


  let parent = inputElement.parentElement;
  for (let i = 0; i < 6 && parent; i++) {
    for (const selector of searchSelectors) {
      try {
        const searchBtn = parent.querySelector(selector);
        if (searchBtn && searchBtn !== inputElement) {

          if (searchBtn.tagName === 'SVG' || searchBtn.tagName === 'I') {
            const btnParent = searchBtn.closest('button');
            if (btnParent) return btnParent;
          }
          return searchBtn;
        }
      } catch (e) {

      }
    }
    parent = parent.parentElement;
  }


  let sibling = inputElement.nextElementSibling;
  while (sibling) {
    const tag = sibling.tagName;
    const text = (sibling.innerText || sibling.textContent || '').toLowerCase();
    const ariaLabel = (sibling.getAttribute('aria-label') || '').toLowerCase();
    const title = (sibling.getAttribute('title') || '').toLowerCase();
    const className = (sibling.className || '').toLowerCase();


    const isSearchRelated =
      text.includes('搜索') || text.includes('search') ||
      ariaLabel.includes('搜索') || ariaLabel.includes('search') ||
      title.includes('搜索') || title.includes('search') ||
      className.includes('search');

    if ((tag === 'BUTTON' || tag === 'INPUT' || sibling.getAttribute('role') === 'button')
        && isSearchRelated) {
      return sibling;
    }
    sibling = sibling.nextElementSibling;
  }

  return null;
}


function findScrollableContainer(axis = 'vertical') {
  const scrollingElement = document.scrollingElement || document.documentElement;

  const scrollableSelectors = [
    'main',
    '[role="main"]',
    '.main-content',
    '.content',
    '.page-content',
    '.scroll-container',
    '.scrollable',
    '#content',
    '#main',
    'article',
  ];


  for (const selector of scrollableSelectors) {
    const el = document.querySelector(selector);
    if (el && el !== scrollingElement && isElementScrollable(el, axis)) {
      return el;
    }
  }


  const allElements = document.querySelectorAll('div, section, article, main, table, pre, ul, ol');
  let bestCandidate = null;
  let maxScrollableSize = 0;

  for (const el of allElements) {
    if (el === scrollingElement) continue;
    if (isElementScrollable(el, axis)) {
      const rect = el.getBoundingClientRect();

      if (rect.height > window.innerHeight * 0.3 &&
          rect.width > window.innerWidth * 0.3) {

        const scrollableSize = axis === 'horizontal' ? el.scrollWidth : el.scrollHeight;
        if (scrollableSize > maxScrollableSize) {
          maxScrollableSize = scrollableSize;
          bestCandidate = el;
        }
      }
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  if (axis === 'horizontal' && isElementScrollable(scrollingElement, 'horizontal')) {
    return scrollingElement;
  }
  if (axis === 'vertical' && isElementScrollable(scrollingElement, 'vertical')) {
    return scrollingElement;
  }

  return null;
}

function isElementScrollable(el, axis = 'any') {
  if (!el) return false;

  const style = window.getComputedStyle(el);
  const overflowY = style.overflowY;
  const overflowX = style.overflowX;

  const hasScrollableY = el.scrollHeight > el.clientHeight;
  const hasScrollableX = el.scrollWidth > el.clientWidth;


  const canScrollY = hasScrollableY && overflowY !== 'hidden';
  const canScrollX = hasScrollableX && overflowX !== 'hidden';

  if (axis === 'vertical') return canScrollY;
  if (axis === 'horizontal') return canScrollX;
  return canScrollY || canScrollX;  // 'any'
}

async function handleScroll(inputs) {
  const direction = (inputs.direction || "down").toLowerCase();
  const amountParam = inputs.amount;


  const isHorizontal = ['left', 'right', 'leftmost', 'rightmost'].includes(direction);
  const scrollAxis = isHorizontal ? 'horizontal' : 'vertical';

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;


  const scrollContainer = findScrollableContainer(scrollAxis);


  let scrollTarget;
  let containerSize;
  let totalSize;
  let currentScroll;

  if (scrollContainer) {

    scrollTarget = scrollContainer;
    if (isHorizontal) {
      containerSize = scrollContainer.clientWidth;
      totalSize = scrollContainer.scrollWidth;
      currentScroll = scrollContainer.scrollLeft;
    } else {
      containerSize = scrollContainer.clientHeight;
      totalSize = scrollContainer.scrollHeight;
      currentScroll = scrollContainer.scrollTop;
    }
    console.log(`[Agent Scroll] Using custom container: <${scrollContainer.tagName.toLowerCase()}> (${totalSize}px ${scrollAxis})`);
  } else {

    scrollTarget = null;
    if (isHorizontal) {
      containerSize = viewportWidth;
      totalSize = document.documentElement.scrollWidth;
      currentScroll = window.scrollX;
    } else {
      containerSize = viewportHeight;
      totalSize = document.documentElement.scrollHeight;
      currentScroll = window.scrollY;
    }
    console.log(`[Agent Scroll] Using window scroll (${totalSize}px ${scrollAxis})`);
  }


  const scrollViewSize = scrollContainer ? containerSize : (isHorizontal ? viewportWidth : viewportHeight);
  let scrollAmount;


  if (direction === "top") {
    if (scrollTarget) {
      scrollTarget.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    console.log("[Agent Scroll] Scrolling to top");
    await sleep(Config.SCROLL_WAIT);
    return;
  }

  if (direction === "bottom") {
    if (scrollTarget) {
      scrollTarget.scrollTo({ top: totalSize, behavior: "smooth" });
    } else {
      window.scrollTo({ top: totalSize, behavior: "smooth" });
    }
    console.log("[Agent Scroll] Scrolling to bottom");
    await sleep(Config.SCROLL_WAIT);
    return;
  }

  if (direction === "leftmost") {
    if (scrollTarget) {
      scrollTarget.scrollTo({ left: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ left: 0, behavior: "smooth" });
    }
    console.log("[Agent Scroll] Scrolling to leftmost");
    await sleep(Config.SCROLL_WAIT);
    return;
  }

  if (direction === "rightmost") {
    if (scrollTarget) {
      scrollTarget.scrollTo({ left: totalSize, behavior: "smooth" });
    } else {
      window.scrollTo({ left: totalSize, behavior: "smooth" });
    }
    console.log("[Agent Scroll] Scrolling to rightmost");
    await sleep(Config.SCROLL_WAIT);
    return;
  }


  if (typeof amountParam === "number") {
    scrollAmount = amountParam;
  } else if (amountParam === "small") {
    scrollAmount = scrollViewSize * 0.3;
  } else if (amountParam === "medium") {
    scrollAmount = scrollViewSize * 0.5;
  } else if (amountParam === "large") {
    scrollAmount = scrollViewSize * 0.9;
  } else {

    scrollAmount = scrollViewSize * 0.7;
  }


  scrollAmount = Math.max(scrollAmount, 100);


  let scrollMultiplier;
  if (direction === "down" || direction === "right") {
    scrollMultiplier = 1;
  } else {
    scrollMultiplier = -1;
  }

  const scrollDelta = scrollAmount * scrollMultiplier;
  const axisLabel = isHorizontal ? 'horizontal' : 'vertical';

  console.log(`[Agent Scroll] ${direction} by ${Math.round(scrollAmount)}px (${Math.round(scrollAmount/scrollViewSize*100)}% of ${axisLabel} view)`);


  if (isHorizontal) {

    if (scrollTarget) {
      scrollTarget.scrollBy({
        left: scrollDelta,
        behavior: "smooth"
      });
    } else {
      window.scrollBy({
        left: scrollDelta,
        behavior: "smooth"
      });
    }
  } else {

    if (scrollTarget) {
      scrollTarget.scrollBy({
        top: scrollDelta,
        behavior: "smooth"
      });
    } else {
      window.scrollBy({
        top: scrollDelta,
        behavior: "smooth"
      });
    }
  }

  await sleep(Config.SCROLL_WAIT);
}

async function handleWait(inputs) {
  const duration = Number.parseInt(inputs.duration_ms ?? inputs.ms ?? 800, 10);
  const boundedDuration = Math.min(Math.max(duration || 800, 100), 5000);
  console.log(`[Agent Wait] Waiting ${boundedDuration}ms`);
  await sleep(boundedDuration);
}


async function handleGoto(inputs) {
  let url = inputs.url;

  if (!url) {
    throw new Error("Goto: missing URL");
  }


  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  console.log(`[Agent Goto] ${url}`);
  window.location.href = url;
}


async function handleExtractText() {
  console.log("[Agent ExtractText] Text extraction requested");

  try {

    const bodyClone = document.body.cloneNode(true);


    const noiseSelectors = [
      'script', 'style', 'noscript', 'svg', 'iframe',
      'nav', 'header', 'footer', 'aside',
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
      '.nav', '.navbar', '.header', '.footer', '.sidebar',
      '[aria-hidden="true"]'
    ];

    noiseSelectors.forEach(selector => {
      try {
        bodyClone.querySelectorAll(selector).forEach(el => el.remove());
      } catch (e) {

      }
    });


    let text = bodyClone.innerText || bodyClone.textContent || '';


    text = text
      .replace(/\t/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ ]{2,}/g, ' ')
      .trim();


    const maxLength = Config.EXTRACT_TEXT_MAX_LENGTH;
    if (text.length > maxLength) {
      text = text.substring(0, maxLength) + '\n\n...[TEXT TRUNCATED]...';
    }


    extractedPageText = text;

    console.log(`[Agent ExtractText] Extracted ${text.length} characters`);

  } catch (error) {
    console.error("[Agent ExtractText] Error:", error);
    extractedPageText = `[Error extracting text: ${error.message}]`;
  }
}


function dispatchMouseEvents(element, x, y, eventTypes) {
  const screenX = window.screenX + x;
  const screenY = window.screenY + y;


  const baseOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    screenX: screenX,
    screenY: screenY,
    clientX: x,
    clientY: y,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false
  };


  const pointerExtra = {
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    width: 1,
    height: 1,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0
  };


  const pointerMap = {
    'mouseover':  'pointerover',
    'mouseenter': 'pointerenter',
    'mousemove':  'pointermove',
    'mousedown':  'pointerdown',
    'mouseup':    'pointerup',

  };

  for (const eventType of eventTypes) {
    const isDown = eventType === 'mousedown';
    const isUp = eventType === 'mouseup';
    const isClick = eventType === 'click';
    const isEnter = eventType === 'mouseenter' || eventType === 'pointerenter';


    const buttons = isUp || isClick ? 0 : (isDown ? 1 : 0);

    const detail = (isDown || isUp || isClick) ? 1 : 0;


    const pointerType = pointerMap[eventType];
    if (pointerType && typeof PointerEvent !== 'undefined') {
      try {
        const pointerEvent = new PointerEvent(pointerType, {
          ...baseOptions,
          ...pointerExtra,
          detail: detail,
          button: (isDown || isUp) ? 0 : -1,
          buttons: buttons,

          bubbles: pointerType !== 'pointerenter',
          pressure: isDown ? 0.5 : 0
        });
        element.dispatchEvent(pointerEvent);
      } catch (e) {

      }
    }


    const mouseEvent = new MouseEvent(eventType, {
      ...baseOptions,
      detail: detail,
      button: 0,
      buttons: buttons,
      relatedTarget: null,

      bubbles: !isEnter,
    });
    element.dispatchEvent(mouseEvent);
  }
}

async function enhancedClick(element, x, y) {


  const clickableElement = findClickableElement(element);
  const targetElement = clickableElement || element;

  if (clickableElement && clickableElement !== element) {
    console.log(`[Agent Click] Found clickable ancestor: <${clickableElement.tagName.toLowerCase()}>`);


  }


  dispatchMouseEvents(targetElement, x, y, ['mouseover', 'mouseenter', 'mousemove']);


  dispatchMouseEvents(targetElement, x, y, ['mousedown']);
  await sleep(10);
  dispatchMouseEvents(targetElement, x, y, ['mouseup']);
  dispatchMouseEvents(targetElement, x, y, ['click']);


  const tag = targetElement.tagName.toLowerCase();
  const isLink = tag === 'a';
  const isButton = tag === 'button' ||
                   (tag === 'input' && ['button', 'submit', 'reset'].includes(targetElement.type));
  const isCheckbox = tag === 'input' && ['checkbox', 'radio'].includes(targetElement.type);


  if (isCheckbox) {
    try {
      targetElement.checked = !targetElement.checked;
      targetElement.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[Agent Click] Checkbox/Radio toggled');
    } catch (e) { }
  }


  if (isLink && targetElement.href) {
    console.log(`[Agent Click] Link: ${targetElement.href.substring(0, 80)}`);
    try {
      targetElement.click();
    } catch (e) {
      console.log('[Agent Click] Native link click failed, navigating directly');
      window.location.href = targetElement.href;
    }
  }


  if (!isLink && !isButton && typeof element.click === 'function') {
    try {
      element.click();
    } catch (e) {
      console.log('[Agent Click] Native click failed:', e);
    }
  }
}

function findNearbyClickableElement(x, y, maxRadius = 80) {
  const offsets = [
    // ~10px
    [0,-10],[0,10],[-10,0],[10,0],[7,-7],[-7,-7],[7,7],[-7,7],
    // ~20px
    [0,-20],[0,20],[-20,0],[20,0],[14,-14],[-14,-14],[14,14],[-14,14],
    // ~30px
    [0,-30],[0,30],[-30,0],[30,0],[21,-21],[-21,-21],[21,21],[-21,21],
    // ~40px
    [0,-40],[0,40],[-40,0],[40,0],[28,-28],[-28,-28],[28,28],[-28,28],
    // ~56px
    [0,-56],[0,56],[-56,0],[56,0],[40,-40],[-40,-40],[40,40],[-40,40],
    // ~72px
    [0,-72],[0,72],[-72,0],[72,0],[50,-50],[-50,-50],[50,50],[-50,50],
    // ~80px
    [0,-80],[0,80],[-80,0],[80,0],
  ];

  let best = null;

  for (const [dx, dy] of offsets) {
    const px = x + dx;
    const py = y + dy;
    if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) continue;

    const el = document.elementFromPoint(px, py);
    if (!el) continue;

    const clickable = findClickableElement(el);
    if (!clickable) continue;

    const dist = Math.sqrt(dx * dx + dy * dy);
    if (!best || dist < best.dist) {
      const rect = clickable.getBoundingClientRect();
      best = {
        element: clickable,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        dist: dist,
      };
    }
  }

  return best;
}

function findClickableElement(element) {
  const MAX_DEPTH = 5;
  let current = element;
  let depth = 0;

  while (current && depth < MAX_DEPTH) {
    if (isClickableElement(current)) {
      return current;
    }
    current = current.parentElement;
    depth++;
  }

  return null;
}

function refineGridLikeClickTarget(x, y, initialElement) {

  let el = initialElement;
  for (let d = 0; el && d < 4; d++, el = el.parentElement) {
    const r = el.getBoundingClientRect();
    if (r.width < 15 || r.height < 15 || r.width > 100 || r.height > 100) continue;
    const t = (el.innerText || el.textContent || '').trim();
    if (/^(?:[1-9]|[12]\d|3[01])$/.test(t) || el.hasAttribute('data-date') || el.hasAttribute('data-day')) {
      return { element: el, x: r.left + r.width / 2, y: r.top + r.height / 2, hits: 1 };
    }
  }


  const container = findCalendarContainer(initialElement);
  if (!container) return null;

  const cells = collectDateCells(container);
  if (cells.length === 0) return null;


  let best = null;
  let bestDistSq = Infinity;

  for (const cell of cells) {
    const rect = cell.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const distSq = (x - cx) ** 2 + (y - cy) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = cell;
    }
  }

  if (!best) return null;

  const rect = best.getBoundingClientRect();
  return {
    element: best,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    hits: cells.length,
  };
}

function findCalendarContainer(el) {
  let current = el;
  let depth = 0;

  while (current && depth < 12) {
    const cls = (current.className || '').toString().toLowerCase();
    const id = (current.id || '').toLowerCase();
    const role = (current.getAttribute?.('role') || '').toLowerCase();
    const ariaLabel = (current.getAttribute?.('aria-label') || '').toLowerCase();

    if (
      /(calendar|datepicker|date-picker|date_picker)/.test(cls) ||
      /(calendar|datepicker|date-picker|date_picker)/.test(id) ||
      role === 'grid' || role === 'dialog' ||
      /(calendar|date\s*picker)/.test(ariaLabel)
    ) {
      return current;
    }


    if (current.querySelector && current.querySelector('table')) {
      const tables = current.querySelectorAll('table');
      for (const table of tables) {
        const tds = table.querySelectorAll('td');
        let dateCount = 0;
        for (const td of tds) {
          const text = (td.innerText || td.textContent || '').trim();
          if (/^(?:[1-9]|[12]\d|3[01])$/.test(text)) dateCount++;
          if (dateCount >= 5) return current;
        }
      }
    }

    current = current.parentElement;
    depth++;
  }

  return null;
}

function collectDateCells(container) {
  const candidates = container.querySelectorAll('td, div, span, button, li, a');
  const cells = [];

  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 15 || rect.height < 15) continue;
    if (rect.width > 100 || rect.height > 100) continue;

    const text = (el.innerText || el.textContent || '').trim();
    const hasDateAttr = el.hasAttribute('data-date') ||
                        el.hasAttribute('data-day') ||
                        el.hasAttribute('data-value');
    const ariaLabel = (el.getAttribute('aria-label') || '');
    const hasDateLabel = /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(ariaLabel) ||
                         /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(el.getAttribute('title') || '');
    const isDayNumber = /^(?:[1-9]|[12]\d|3[01])$/.test(text);


    let childHasDayNumber = false;
    if (!isDayNumber && el.children.length > 0 && el.children.length <= 3) {
      for (const child of el.children) {
        const ct = (child.innerText || child.textContent || '').trim();
        if (/^(?:[1-9]|[12]\d|3[01])$/.test(ct)) {
          childHasDayNumber = true;
          break;
        }
      }
    }

    if (isDayNumber || childHasDayNumber || hasDateAttr || hasDateLabel) {

      const dominated = cells.some(c => c.contains(el) && c !== el);
      if (!dominated) {

        for (let i = cells.length - 1; i >= 0; i--) {
          if (el.contains(cells[i]) && el !== cells[i]) {
            cells.splice(i, 1);
          }
        }
        cells.push(el);
      }
    }
  }

  return cells;
}


function isClickableElement(el) {
  if (!el) return false;

  const tag = el.tagName.toLowerCase();


  if (['a', 'button', 'select', 'summary'].includes(tag)) {
    return true;
  }


  if (tag === 'input') {
    const type = (el.type || '').toLowerCase();
    if (['button', 'submit', 'reset', 'checkbox', 'radio', 'file'].includes(type)) {
      return true;
    }
  }


  const role = el.getAttribute('role');
  if (role && ['button', 'link', 'tab', 'menuitem', 'option', 'checkbox', 'radio'].includes(role)) {
    return true;
  }


  if (el.onclick || el.getAttribute('onclick')) {
    return true;
  }


  if (el.hasAttribute('tabindex') && getComputedStyle(el).cursor === 'pointer') {
    return true;
  }

  return false;
}

function isInputElement(el) {
  if (!el) return false;

  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    el.isContentEditable ||
    el.getAttribute("role") === "textbox"
  );
}

function isEditableInputElement(el) {
  if (!isInputElement(el)) return false;
  if (el.disabled || el.readOnly) return false;
  if (!isElementVisible(el)) return false;
  return true;
}

function findNearbyInput(x, y, radius = Config.NEARBY_INPUT_RADIUS) {
  const inputs = document.querySelectorAll(
    'input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"]'
  );

  let nearest = null;
  let minDistSq = radius * radius;

  for (const input of inputs) {
    if (!isEditableInputElement(input)) continue;

    const rect = input.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const distSq = (cx - x) ** 2 + (cy - y) ** 2;

    if (distSq < minDistSq) {
      minDistSq = distSq;
      nearest = input;
    }
  }

  return nearest;
}


function showClickIndicator(x, y, actionType = "click") {
  const color = actionType === "type" ? Config.COLOR_TYPE : Config.COLOR_CLICK;


  const indicator = document.createElement("div");
  indicator.className = "browseraide-agent-click-indicator";
  indicator.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 2147483647;
  `;


  const outerRing = document.createElement("div");
  outerRing.style.cssText = `
    position: absolute;
    left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    width: 40px; height: 40px;
    border: 3px solid ${color};
    border-radius: 50%;
    animation: browseraide-ring-expand 0.6s ease-out forwards;
  `;


  const centerDot = document.createElement("div");
  centerDot.style.cssText = `
    position: absolute;
    left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    width: 12px; height: 12px;
    background: ${color};
    border-radius: 50%;
    box-shadow: 0 0 10px ${color};
    animation: browseraide-dot-pulse 0.6s ease-out forwards;
  `;


  const label = document.createElement("div");
  label.style.cssText = `
    position: absolute;
    left: 50%; top: 30px;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-family: monospace;
    white-space: nowrap;
  `;
  label.textContent = `${actionType} (${Math.round(x)}, ${Math.round(y)})`;


  indicator.append(outerRing, centerDot, label);
  ensureAnimationStyles();
  document.body.appendChild(indicator);


  setTimeout(() => indicator.remove(), Config.INDICATOR_DURATION);
}


function getUserNotificationReason(reason) {
  const text = String(reason || "").trim();
  if (!text) return "Manual action is required to continue.";

  // The page banner is English-only, even when the model reason is localized.
  if (/\p{Script=Han}/u.test(text)) {
    return "Manual action is required to continue.";
  }

  return text;
}

function showUserNotification(reason) {

  hideUserNotification();
  const displayReason = getUserNotificationReason(reason);

  const banner = document.createElement("div");
  banner.id = "browseraide-agent-user-banner";
  banner.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0;
    background: linear-gradient(135deg, #f59e0b, #d97706);
    color: white;
    padding: 12px 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    text-align: center;
    z-index: 2147483647;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    animation: browseraide-banner-slide-in 0.3s ease-out;
  `;

  banner.innerHTML = `
    <span style="font-size: 20px;">🙋</span>
    <span><strong>Action required:</strong> ${escapeHtml(displayReason)}</span>
    <span style="
      background: rgba(255,255,255,0.2);
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
    ">Click "Resume" in the side panel after you finish.</span>
  `;

  ensureBannerStyles();
  document.body.appendChild(banner);
}

function hideUserNotification() {
  document.getElementById("browseraide-agent-user-banner")?.remove();
}


function ensureAnimationStyles() {
  if (document.getElementById("browseraide-agent-styles")) return;

  const style = document.createElement("style");
  style.id = "browseraide-agent-styles";
  style.textContent = `
    @keyframes browseraide-ring-expand {
      0% { width: 20px; height: 20px; opacity: 1; }
      100% { width: 60px; height: 60px; opacity: 0; }
    }
    @keyframes browseraide-dot-pulse {
      0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
      50% { transform: translate(-50%, -50%) scale(1.5); }
      100% { transform: translate(-50%, -50%) scale(1); opacity: 0.3; }
    }
  `;
  document.head.appendChild(style);
}

function ensureBannerStyles() {
  if (document.getElementById("browseraide-agent-banner-styles")) return;

  const style = document.createElement("style");
  style.id = "browseraide-agent-banner-styles";
  style.textContent = `
    @keyframes browseraide-banner-slide-in {
      from { transform: translateY(-100%); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}


window.addEventListener('__agent_benchmark_request', async (event) => {
  const { id, type, data } = event.detail || {};

  if (!type) return;

  console.log('[Agent Bridge] Received request:', type, data);

  try {

    const response = await chrome.runtime.sendMessage({
      type: type,
      ...data
    });


    window.dispatchEvent(new CustomEvent('__agent_benchmark_response', {
      detail: { id, response }
    }));
  } catch (error) {
    window.dispatchEvent(new CustomEvent('__agent_benchmark_response', {
      detail: { id, error: error.message }
    }));
  }
});


window.__agentBridgeReady = true;


console.log("[Agent] Content script loaded - Three-Mode Execute module ready");
console.log("[Agent] Benchmark bridge enabled");
