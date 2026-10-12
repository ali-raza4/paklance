const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const editorSource = `
import { Editor, Node, Extension, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';

// Helper for block node moving, duplicating, deleting in ProseMirror
function moveBlockNode(editor, getPos, node, direction) {
  const pos = typeof getPos === 'function' ? getPos() : getPos;
  if (pos === undefined || pos === null) return;
  const { state, view } = editor;
  const $pos = state.doc.resolve(pos);
  const index = $pos.index();
  const parent = $pos.parent;
  const tr = state.tr;
  const nodeJson = node.toJSON();

  if (direction === 'up') {
    if (index === 0) return;
    const prevChild = parent.child(index - 1);
    const prevPos = pos - prevChild.nodeSize;
    tr.delete(pos, pos + node.nodeSize);
    tr.insert(prevPos, state.schema.nodeFromJSON(nodeJson));
    view.dispatch(tr);
  } else if (direction === 'down') {
    if (index >= parent.childCount - 1) return;
    const nextChild = parent.child(index + 1);
    tr.delete(pos, pos + node.nodeSize);
    const insertPos = pos + nextChild.nodeSize;
    tr.insert(insertPos, state.schema.nodeFromJSON(nodeJson));
    view.dispatch(tr);
  }
}

function duplicateBlockNode(editor, getPos, node) {
  const pos = typeof getPos === 'function' ? getPos() : getPos;
  if (pos === undefined || pos === null) return;
  const { state, view } = editor;
  const tr = state.tr;
  const nodeJson = node.toJSON();
  tr.insert(pos + node.nodeSize, state.schema.nodeFromJSON(nodeJson));
  view.dispatch(tr);
}

function deleteBlockNode(editor, getPos, node) {
  const pos = typeof getPos === 'function' ? getPos() : getPos;
  if (pos === undefined || pos === null) return;
  const { state, view } = editor;
  const tr = state.tr;
  tr.delete(pos, pos + node.nodeSize);
  view.dispatch(tr);
}

function updateNodeAttrs(editor, getPos, node, newAttrs) {
  const pos = typeof getPos === 'function' ? getPos() : getPos;
  if (pos === undefined || pos === null) return;
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    ...newAttrs
  });
  editor.view.dispatch(tr);
}

// Apply custom colors to an element
function applyBlockCustomColors(el, attrs) {
  if (!el) return;
  if (attrs.bgColor) {
    el.style.backgroundColor = attrs.bgColor;
  } else {
    el.style.backgroundColor = '';
  }
  if (attrs.textColor) {
    el.style.color = attrs.textColor;
  } else {
    el.style.color = '';
  }
  if (attrs.borderColor) {
    el.style.borderColor = attrs.borderColor;
  } else {
    el.style.borderColor = '';
  }
}

function getStyleStringForColors(attrs) {
  let s = '';
  if (attrs.bgColor) s += 'background-color:' + attrs.bgColor + ';';
  if (attrs.textColor) s += 'color:' + attrs.textColor + ';';
  if (attrs.borderColor) s += 'border-color:' + attrs.borderColor + ';';
  return s;
}

// Create Block Controls Header for any NodeView
function createBlockControls(label, onMoveUp, onMoveDown, onDuplicate, onDelete, onEdit, onColor) {
  const bar = document.createElement('div');
  bar.className = 'doc-block-toolbar';
  bar.setAttribute('contenteditable', 'false');

  const tag = document.createElement('span');
  tag.className = 'doc-block-tag';
  tag.textContent = label;
  bar.appendChild(tag);

  const actions = document.createElement('div');
  actions.className = 'doc-block-actions';

  if (onEdit) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'doc-block-btn doc-block-btn-edit';
    editBtn.title = 'Edit Block Content';
    editBtn.innerHTML = '✎ Edit';
    editBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onEdit(); };
    actions.appendChild(editBtn);
  }

  if (onColor) {
    const colorBtn = document.createElement('button');
    colorBtn.type = 'button';
    colorBtn.className = 'doc-block-btn doc-block-btn-color';
    colorBtn.title = 'Customize Colors';
    colorBtn.innerHTML = '🎨 Colors';
    colorBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onColor(); };
    actions.appendChild(colorBtn);
  }

  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'doc-block-btn';
  upBtn.title = 'Move Up';
  upBtn.innerHTML = '↑';
  upBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onMoveUp(); };
  actions.appendChild(upBtn);

  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'doc-block-btn';
  downBtn.title = 'Move Down';
  downBtn.innerHTML = '↓';
  downBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onMoveDown(); };
  actions.appendChild(downBtn);

  if (onDuplicate) {
    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'doc-block-btn';
    dupBtn.title = 'Duplicate';
    dupBtn.innerHTML = '⧉';
    dupBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onDuplicate(); };
    actions.appendChild(dupBtn);
  }

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'doc-block-btn doc-block-del';
  delBtn.title = 'Delete Block';
  delBtn.innerHTML = '✕';
  delBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onDelete(); };
  actions.appendChild(delBtn);

  bar.appendChild(actions);
  return bar;
}

// 1. Blog Table Extension
const BlogTable = Table.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      HTMLAttributes: {
        class: 'blog-table'
      },
      resizable: true
    };
  },
  parseHTML() {
    return [
      { tag: 'div.blog-table-wrap table' },
      { tag: 'table.blog-table' },
      { tag: 'table' }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['table', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  }
});

// 2. Blog Figure (Image + Caption + Width + Alignment + Colors)
const BlogFigure = Node.create({
  name: 'blogFigure',
  group: 'block',
  selectable: true,
  draggable: true,
  isolating: true,
  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      caption: { default: '' },
      align: { default: 'center' }, // center, left, right
      width: { default: '100%' }, // 100%, 75%, 50%
      bgColor: { default: '' },
      textColor: { default: '' },
      borderColor: { default: '' }
    };
  },
  parseHTML() {
    return [
      {
        tag: 'figure.blog-figure',
        getAttrs: (dom) => {
          const img = dom.querySelector('img');
          const cap = dom.querySelector('figcaption');
          let align = 'center';
          if (dom.classList.contains('blog-figure-left')) align = 'left';
          else if (dom.classList.contains('blog-figure-right')) align = 'right';
          const w = dom.getAttribute('data-width') || dom.style.maxWidth || '100%';
          return {
            src: img ? img.getAttribute('src') : '',
            alt: img ? img.getAttribute('alt') || '' : '',
            caption: cap ? cap.innerHTML : '',
            align: dom.getAttribute('data-align') || align,
            width: w.replace(';', ''),
            bgColor: dom.getAttribute('data-bg-color') || dom.style.backgroundColor || '',
            textColor: dom.getAttribute('data-text-color') || dom.style.color || '',
            borderColor: dom.getAttribute('data-border-color') || dom.style.borderColor || ''
          };
        }
      },
      {
        tag: 'figure',
        getAttrs: (dom) => {
          const img = dom.querySelector('img');
          const cap = dom.querySelector('figcaption');
          return {
            src: img ? img.getAttribute('src') : '',
            alt: img ? img.getAttribute('alt') || '' : '',
            caption: cap ? cap.innerHTML : '',
            align: 'center',
            width: '100%',
            bgColor: dom.getAttribute('data-bg-color') || dom.style.backgroundColor || '',
            textColor: dom.getAttribute('data-text-color') || dom.style.color || '',
            borderColor: dom.getAttribute('data-border-color') || dom.style.borderColor || ''
          };
        }
      },
      {
        tag: 'p img',
        getAttrs: (dom) => {
          return {
            src: dom.getAttribute('src') || '',
            alt: dom.getAttribute('alt') || '',
            caption: '',
            align: 'center',
            width: '100%',
            bgColor: '',
            textColor: '',
            borderColor: ''
          };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const alignClass = 'blog-figure-' + (HTMLAttributes.align || 'center');
    const widthVal = HTMLAttributes.width || '100%';
    let figureStyle = 'max-width:' + widthVal + ';margin:24px auto;';
    figureStyle += getStyleStringForColors(HTMLAttributes);

    const children = [
      [
        'img',
        {
          src: HTMLAttributes.src,
          alt: HTMLAttributes.alt || '',
          style: 'width:100%;border-radius:12px;display:block;box-shadow:0 2px 10px rgba(0,0,0,0.06)'
        }
      ]
    ];
    if (HTMLAttributes.caption && HTMLAttributes.caption.trim()) {
      children.push(['figcaption', { class: 'blog-figcaption' }, HTMLAttributes.caption]);
    }
    return [
      'figure',
      {
        class: 'blog-figure ' + alignClass,
        'data-align': HTMLAttributes.align || 'center',
        'data-width': widthVal,
        'data-bg-color': HTMLAttributes.bgColor || '',
        'data-text-color': HTMLAttributes.textColor || '',
        'data-border-color': HTMLAttributes.borderColor || '',
        style: figureStyle
      },
      ...children
    ];
  },
  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'doc-block-wrapper doc-block-figure';

      const openEdit = () => {
        if (window.PaklanceEditorUI && typeof window.PaklanceEditorUI.openImageModal === 'function') {
          window.PaklanceEditorUI.openImageModal(node.attrs, (newAttrs) => {
            updateNodeAttrs(editor, getPos, node, newAttrs);
          });
        }
      };

      const openColor = () => {
        if (window.PaklanceEditorUI && typeof window.PaklanceEditorUI.openBlockColorModal === 'function') {
          window.PaklanceEditorUI.openBlockColorModal('blogFigure', node.attrs, (newAttrs) => {
            updateNodeAttrs(editor, getPos, node, newAttrs);
          });
        }
      };

      const toolbar = createBlockControls(
        'IMAGE BLOCK',
        () => moveBlockNode(editor, getPos, node, 'up'),
        () => moveBlockNode(editor, getPos, node, 'down'),
        () => duplicateBlockNode(editor, getPos, node),
        () => deleteBlockNode(editor, getPos, node),
        openEdit,
        openColor
      );
      dom.appendChild(toolbar);

      const figure = document.createElement('figure');
      const alignClass = 'blog-figure-' + (node.attrs.align || 'center');
      figure.className = 'blog-figure ' + alignClass;
      figure.style.maxWidth = node.attrs.width || '100%';
      figure.style.margin = '14px auto';
      applyBlockCustomColors(figure, node.attrs);

      const img = document.createElement('img');
      img.src = node.attrs.src || '';
      img.alt = node.attrs.alt || '';
      img.style.width = '100%';
      img.style.borderRadius = '12px';
      img.style.display = 'block';
      img.style.boxShadow = '0 2px 10px rgba(0,0,0,0.06)';
      figure.appendChild(img);

      const cap = document.createElement('figcaption');
      cap.className = 'blog-figcaption';
      cap.setAttribute('contenteditable', 'true');
      cap.setAttribute('data-placeholder', 'Write image caption...');
      cap.innerHTML = node.attrs.caption || '';
      cap.onblur = () => {
        updateNodeAttrs(editor, getPos, node, { caption: cap.innerHTML });
      };
      figure.appendChild(cap);

      dom.appendChild(figure);

      dom.onclick = () => {
        document.querySelectorAll('.doc-block-wrapper').forEach(w => w.classList.remove('is-selected'));
        dom.classList.add('is-selected');
      };

      return {
        dom,
        stopEvent: (event) => {
          const target = event.target;
          return target.isContentEditable || ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target.tagName);
        },
        ignoreMutation: () => true,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'blogFigure') return false;
          if (dom.contains(document.activeElement)) return true;
          img.src = updatedNode.attrs.src || '';
          img.alt = updatedNode.attrs.alt || '';
          figure.style.maxWidth = updatedNode.attrs.width || '100%';
          figure.className = 'blog-figure blog-figure-' + (updatedNode.attrs.align || 'center');
          applyBlockCustomColors(figure, updatedNode.attrs);
          if (cap.innerHTML !== updatedNode.attrs.caption) {
            cap.innerHTML = updatedNode.attrs.caption || '';
          }
          return true;
        }
      };
    };
  }
});

// 3. Blog Quote (Pull Quote + Citation + Colors)
const BlogQuote = Node.create({
  name: 'blogQuote',
  group: 'block',
  selectable: true,
  draggable: true,
  isolating: true,
  addAttributes() {
    return {
      text: { default: 'Paklance was engineered from day one to give Pakistani specialists equal global footing with zero foreign exchange friction and guaranteed milestone protection.' },
      cite: { default: 'Paklance Product Team' },
      bgColor: { default: '' },
      textColor: { default: '' },
      borderColor: { default: '' }
    };
  },
  parseHTML() {
    return [
      {
        tag: 'blockquote.blog-quote',
        getAttrs: (dom) => {
          const p = dom.querySelector('p');
          const cite = dom.querySelector('cite');
          return {
            text: p ? p.innerHTML : dom.innerHTML,
            cite: cite ? cite.innerText : 'Paklance Product Team',
            bgColor: dom.getAttribute('data-bg-color') || dom.style.backgroundColor || '',
            textColor: dom.getAttribute('data-text-color') || dom.style.color || '',
            borderColor: dom.getAttribute('data-border-color') || dom.style.borderColor || ''
          };
        }
      },
      {
        tag: 'blockquote',
        getAttrs: (dom) => {
          const cite = dom.querySelector('cite');
          const p = dom.querySelector('p');
          return {
            text: p ? p.innerHTML : dom.innerHTML,
            cite: cite ? cite.innerText : 'Author',
            bgColor: dom.getAttribute('data-bg-color') || dom.style.backgroundColor || '',
            textColor: dom.getAttribute('data-text-color') || dom.style.color || '',
            borderColor: dom.getAttribute('data-border-color') || dom.style.borderColor || ''
          };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const customStyle = getStyleStringForColors(HTMLAttributes);
    return [
      'blockquote',
      {
        class: 'blog-quote',
        'data-bg-color': HTMLAttributes.bgColor || '',
        'data-text-color': HTMLAttributes.textColor || '',
        'data-border-color': HTMLAttributes.borderColor || '',
        style: customStyle || undefined
      },
      ['p', {}, HTMLAttributes.text || ''],
      ['cite', {}, HTMLAttributes.cite || 'Paklance Product Team']
    ];
  },
  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'doc-block-wrapper doc-block-quote';

      const openEdit = () => {
        if (window.PaklanceEditorUI && typeof window.PaklanceEditorUI.openBlockEditModal === 'function') {
          window.PaklanceEditorUI.openBlockEditModal('blogQuote', node.attrs, (newAttrs) => {
            updateNodeAttrs(editor, getPos, node, newAttrs);
          });
        }
      };

      const openColor = () => {
        if (window.PaklanceEditorUI && typeof window.PaklanceEditorUI.openBlockColorModal === 'function') {
          window.PaklanceEditorUI.openBlockColorModal('blogQuote', node.attrs, (newAttrs) => {
            updateNodeAttrs(editor, getPos, node, newAttrs);
          });
        }
      };

      const toolbar = createBlockControls(
        'HIGHLIGHTED QUOTE',
        () => moveBlockNode(editor, getPos, node, 'up'),
        () => moveBlockNode(editor, getPos, node, 'down'),
        () => duplicateBlockNode(editor, getPos, node),
        () => deleteBlockNode(editor, getPos, node),
        openEdit,
        openColor
      );
      dom.appendChild(toolbar);

      const bq = document.createElement('blockquote');
      bq.className = 'blog-quote';
      applyBlockCustomColors(bq, node.attrs);

      const p = document.createElement('p');
      p.setAttribute('contenteditable', 'true');
      p.innerHTML = node.attrs.text || '';
      p.onblur = () => {
        updateNodeAttrs(editor, getPos, node, { text: p.innerHTML });
      };
      bq.appendChild(p);

      const cite = document.createElement('cite');
      cite.setAttribute('contenteditable', 'true');
      cite.textContent = node.attrs.cite || 'Paklance Product Team';
      cite.onblur = () => {
        updateNodeAttrs(editor, getPos, node, { cite: cite.textContent });
      };
      bq.appendChild(cite);

      dom.appendChild(bq);

      dom.onclick = () => {
        document.querySelectorAll('.doc-block-wrapper').forEach(w => w.classList.remove('is-selected'));
        dom.classList.add('is-selected');
      };

      return {
        dom,
        stopEvent: (event) => {
          const target = event.target;
          return target.isContentEditable || ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target.tagName);
        },
        ignoreMutation: () => true,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'blogQuote') return false;
          if (dom.contains(document.activeElement)) return true;
          applyBlockCustomColors(bq, updatedNode.attrs);
          if (p.innerHTML !== updatedNode.attrs.text) p.innerHTML = updatedNode.attrs.text || '';
          if (cite.textContent !== updatedNode.attrs.cite) cite.textContent = updatedNode.attrs.cite || '';
          return true;
        }
      };
    };
  }
});

// 4. Blog Tip (Callout / Pro Tip + Colors)
const BlogTip = Node.create({
  name: 'blogTip',
  group: 'block',
  selectable: true,
  draggable: true,
  isolating: true,
  addAttributes() {
    return {
      title: { default: 'Pro Tip: Milestone Escrow Protection' },
      text: { default: 'Always verify SafePay milestone funding is locked in escrow before commencing work on any project deliverable to guarantee 100% payment security.' },
      bgColor: { default: '' },
      textColor: { default: '' },
      borderColor: { default: '' }
    };
  },
  parseHTML() {
    return [
      {
        tag: 'aside.blog-tip',
        getAttrs: (dom) => {
          const strong = dom.querySelector('strong');
          const p = dom.querySelector('p');
          return {
            title: strong ? strong.innerText : 'Pro Tip',
            text: p ? p.innerHTML : '',
            bgColor: dom.getAttribute('data-bg-color') || dom.style.backgroundColor || '',
            textColor: dom.getAttribute('data-text-color') || dom.style.color || '',
            borderColor: dom.getAttribute('data-border-color') || dom.style.borderColor || ''
          };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const customStyle = getStyleStringForColors(HTMLAttributes);
    return [
      'aside',
      {
        class: 'blog-tip',
        'data-bg-color': HTMLAttributes.bgColor || '',
        'data-text-color': HTMLAttributes.textColor || '',
        'data-border-color': HTMLAttributes.borderColor || '',
        style: customStyle || undefined
      },
      [
        'svg',
        {
          class: 'ic',
          viewBox: '0 0 24 24',
          width: '22',
          height: '22',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '2',
          style: 'color:var(--brand-3);flex-shrink:0;margin-top:2px'
        },
        ['path', { d: 'M9 18h6m-4 4h2M12 2a7 7 0 0 0-7 7c0 3 2 5 2 7h10c0-2 2-4 2-7a7 7 0 0 0-7-7z' }]
      ],
      [
        'div',
        {},
        ['strong', {}, HTMLAttributes.title || 'Pro Tip'],
        ['p', {}, HTMLAttributes.text || '']
      ]
    ];
  },
  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'doc-block-wrapper doc-block-tip';

      const openEdit = () => {
        if (window.PaklanceEditorUI && typeof window.PaklanceEditorUI.openBlockEditModal === 'function') {
          window.PaklanceEditorUI.openBlockEditModal('blogTip', node.attrs, (newAttrs) => {
            updateNodeAttrs(editor, getPos, node, newAttrs);
          });
        }
      };

      const openColor = () => {
        if (window.PaklanceEditorUI && typeof window.PaklanceEditorUI.openBlockColorModal === 'function') {
          window.PaklanceEditorUI.openBlockColorModal('blogTip', node.attrs, (newAttrs) => {
            updateNodeAttrs(editor, getPos, node, newAttrs);
          });
        }
      };

      const toolbar = createBlockControls(
        'PRO TIP / CALLOUT',
        () => moveBlockNode(editor, getPos, node, 'up'),
        () => moveBlockNode(editor, getPos, node, 'down'),
        () => duplicateBlockNode(editor, getPos, node),
        () => deleteBlockNode(editor, getPos, node),
        openEdit,
        openColor
      );
      dom.appendChild(toolbar);

      const tip = document.createElement('aside');
      tip.className = 'blog-tip';
      applyBlockCustomColors(tip, node.attrs);

      const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      iconSvg.setAttribute('class', 'ic');
      iconSvg.setAttribute('viewBox', '0 0 24 24');
      iconSvg.setAttribute('width', '22');
      iconSvg.setAttribute('height', '22');
      iconSvg.setAttribute('fill', 'none');
      iconSvg.setAttribute('stroke', 'currentColor');
      iconSvg.setAttribute('stroke-width', '2');
      iconSvg.style.color = 'var(--brand-3)';
      iconSvg.style.flexShrink = '0';
      iconSvg.style.marginTop = '2px';
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M9 18h6m-4 4h2M12 2a7 7 0 0 0-7 7c0 3 2 5 2 7h10c0-2 2-4 2-7a7 7 0 0 0-7-7z');
      iconSvg.appendChild(path);
      tip.appendChild(iconSvg);

      const contentDiv = document.createElement('div');
      contentDiv.style.flex = '1';

      const strong = document.createElement('strong');
      strong.setAttribute('contenteditable', 'true');
      strong.textContent = node.attrs.title || 'Pro Tip';
      strong.onblur = () => {
        updateNodeAttrs(editor, getPos, node, { title: strong.textContent });
      };
      contentDiv.appendChild(strong);

      const p = document.createElement('p');
      p.setAttribute('contenteditable', 'true');
      p.innerHTML = node.attrs.text || '';
      p.onblur = () => {
        updateNodeAttrs(editor, getPos, node, { text: p.innerHTML });
      };
      contentDiv.appendChild(p);

      tip.appendChild(contentDiv);
      dom.appendChild(tip);

      dom.onclick = () => {
        document.querySelectorAll('.doc-block-wrapper').forEach(w => w.classList.remove('is-selected'));
        dom.classList.add('is-selected');
      };

      return {
        dom,
        stopEvent: (event) => {
          const target = event.target;
          return target.isContentEditable || ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target.tagName);
        },
        ignoreMutation: () => true,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'blogTip') return false;
          if (dom.contains(document.activeElement)) return true;
          applyBlockCustomColors(tip, updatedNode.attrs);
          if (strong.textContent !== updatedNode.attrs.title) strong.textContent = updatedNode.attrs.title || '';
          if (p.innerHTML !== updatedNode.attrs.text) p.innerHTML = updatedNode.attrs.text || '';
          return true;
        }
      };
    };
  }
});

// 5. Blog Statistics Cards (+ Colors)
const BlogStats = Node.create({
  name: 'blogStats',
  group: 'block',
  selectable: true,
  draggable: true,
  isolating: true,
  addAttributes() {
    return {
      card1Num: { default: 'PKR 0' },
      card1Label: { default: 'Foreign Exchange Fees' },
      card2Num: { default: '100%' },
      card2Label: { default: 'SafePay Escrow Protection' },
      card3Num: { default: 'Top 3%' },
      card3Label: { default: 'Verified Pakistani Specialists' },
      bgColor: { default: '' },
      textColor: { default: '' },
      borderColor: { default: '' }
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div.blog-stats-grid',
        getAttrs: (dom) => {
          const cards = dom.querySelectorAll('.blog-stat-card');
          const c1 = cards[0], c2 = cards[1], c3 = cards[2];
          return {
            card1Num: c1 ? (c1.querySelector('.blog-stat-num')?.innerText || 'PKR 0') : 'PKR 0',
            card1Label: c1 ? (c1.querySelector('.blog-stat-label')?.innerText || '') : '',
            card2Num: c2 ? (c2.querySelector('.blog-stat-num')?.innerText || '100%') : '100%',
            card2Label: c2 ? (c2.querySelector('.blog-stat-label')?.innerText || '') : '',
            card3Num: c3 ? (c3.querySelector('.blog-stat-num')?.innerText || 'Top 3%') : 'Top 3%',
            card3Label: c3 ? (c3.querySelector('.blog-stat-label')?.innerText || '') : '',
            bgColor: dom.getAttribute('data-bg-color') || dom.style.backgroundColor || '',
            textColor: dom.getAttribute('data-text-color') || dom.style.color || '',
            borderColor: dom.getAttribute('data-border-color') || dom.style.borderColor || ''
          };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const cardStyle = getStyleStringForColors(HTMLAttributes);
    return [
      'div',
      {
        class: 'blog-stats-grid',
        'data-bg-color': HTMLAttributes.bgColor || '',
        'data-text-color': HTMLAttributes.textColor || '',
        'data-border-color': HTMLAttributes.borderColor || ''
      },
      [
        'div',
        { class: 'blog-stat-card', style: cardStyle || undefined },
        ['div', { class: 'blog-stat-num' }, HTMLAttributes.card1Num || 'PKR 0'],
        ['div', { class: 'blog-stat-label' }, HTMLAttributes.card1Label || '']
      ],
      [
        'div',
        { class: 'blog-stat-card', style: cardStyle || undefined },
        ['div', { class: 'blog-stat-num' }, HTMLAttributes.card2Num || '100%'],
        ['div', { class: 'blog-stat-label' }, HTMLAttributes.card2Label || '']
      ],
      [
        'div',
        { class: 'blog-stat-card', style: cardStyle || undefined },
        ['div', { class: 'blog-stat-num' }, HTMLAttributes.card3Num || 'Top 3%'],
        ['div', { class: 'blog-stat-label' }, HTMLAttributes.card3Label || '']
      ]
    ];
  },
  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'doc-block-wrapper doc-block-stats';

      const openEdit = () => {
        if (window.PaklanceEditorUI && typeof window.PaklanceEditorUI.openBlockEditModal === 'function') {
          window.PaklanceEditorUI.openBlockEditModal('blogStats', node.attrs, (newAttrs) => {
            updateNodeAttrs(editor, getPos, node, newAttrs);
          });
        }
      };

      const openColor = () => {
        if (window.PaklanceEditorUI && typeof window.PaklanceEditorUI.openBlockColorModal === 'function') {
          window.PaklanceEditorUI.openBlockColorModal('blogStats', node.attrs, (newAttrs) => {
            updateNodeAttrs(editor, getPos, node, newAttrs);
          });
        }
      };

      const toolbar = createBlockControls(
        'STATISTICS CARDS',
        () => moveBlockNode(editor, getPos, node, 'up'),
        () => moveBlockNode(editor, getPos, node, 'down'),
        () => duplicateBlockNode(editor, getPos, node),
        () => deleteBlockNode(editor, getPos, node),
        openEdit,
        openColor
      );
      dom.appendChild(toolbar);

      const grid = document.createElement('div');
      grid.className = 'blog-stats-grid';

      const cData = [
        { numKey: 'card1Num', labelKey: 'card1Label' },
        { numKey: 'card2Num', labelKey: 'card2Label' },
        { numKey: 'card3Num', labelKey: 'card3Label' }
      ];

      const cardEls = [];
      cData.forEach(item => {
        const card = document.createElement('div');
        card.className = 'blog-stat-card';
        applyBlockCustomColors(card, node.attrs);

        const num = document.createElement('div');
        num.className = 'blog-stat-num';
        num.setAttribute('contenteditable', 'true');
        num.textContent = node.attrs[item.numKey] || '';
        num.onblur = () => {
          updateNodeAttrs(editor, getPos, node, { [item.numKey]: num.textContent });
        };
        card.appendChild(num);

        const lbl = document.createElement('div');
        lbl.className = 'blog-stat-label';
        lbl.setAttribute('contenteditable', 'true');
        lbl.textContent = node.attrs[item.labelKey] || '';
        lbl.onblur = () => {
          updateNodeAttrs(editor, getPos, node, { [item.labelKey]: lbl.textContent });
        };
        card.appendChild(lbl);

        grid.appendChild(card);
        cardEls.push({ card, num, lbl, item });
      });

      dom.appendChild(grid);

      dom.onclick = () => {
        document.querySelectorAll('.doc-block-wrapper').forEach(w => w.classList.remove('is-selected'));
        dom.classList.add('is-selected');
      };

      return {
        dom,
        stopEvent: (event) => {
          const target = event.target;
          return target.isContentEditable || ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target.tagName);
        },
        ignoreMutation: () => true,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'blogStats') return false;
          if (dom.contains(document.activeElement)) return true;
          cardEls.forEach(({ card, num, lbl, item }) => {
            applyBlockCustomColors(card, updatedNode.attrs);
            if (num.textContent !== updatedNode.attrs[item.numKey]) num.textContent = updatedNode.attrs[item.numKey] || '';
            if (lbl.textContent !== updatedNode.attrs[item.labelKey]) lbl.textContent = updatedNode.attrs[item.labelKey] || '';
          });
          return true;
        }
      };
    };
  }
});

// 6. Blog Multi-Column Layout (2 or 3 columns + Colors)
const BlogColumns = Node.create({
  name: 'blogColumns',
  group: 'block',
  selectable: true,
  draggable: true,
  isolating: true,
  addAttributes() {
    return {
      cols: { default: 2 }, // 2 or 3
      col1: { default: 'Left column insights: Discuss key advantages, methods, or details for your audience.' },
      col2: { default: 'Right column insights: Outline supporting data, practical execution steps, or key takeaways.' },
      col3: { default: 'Third column insights (optional): Add further perspective or next actions.' },
      bgColor: { default: '' },
      textColor: { default: '' },
      borderColor: { default: '' }
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div.blog-columns',
        getAttrs: (dom) => {
          const is3 = dom.classList.contains('blog-cols-3');
          const cols = dom.querySelectorAll('.blog-col');
          return {
            cols: is3 ? 3 : 2,
            col1: cols[0] ? cols[0].innerHTML : '',
            col2: cols[1] ? cols[1].innerHTML : '',
            col3: cols[2] ? cols[2].innerHTML : '',
            bgColor: dom.getAttribute('data-bg-color') || dom.style.backgroundColor || '',
            textColor: dom.getAttribute('data-text-color') || dom.style.color || '',
            borderColor: dom.getAttribute('data-border-color') || dom.style.borderColor || ''
          };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const is3 = Number(HTMLAttributes.cols) === 3;
    const colClass = is3 ? 'blog-columns blog-cols-3' : 'blog-columns blog-cols-2';
    const colStyle = getStyleStringForColors(HTMLAttributes);

    const children = [
      ['div', { class: 'blog-col', style: colStyle || undefined }, HTMLAttributes.col1 || ''],
      ['div', { class: 'blog-col', style: colStyle || undefined }, HTMLAttributes.col2 || '']
    ];
    if (is3) {
      children.push(['div', { class: 'blog-col', style: colStyle || undefined }, HTMLAttributes.col3 || '']);
    }
    return [
      'div',
      {
        class: colClass,
        'data-bg-color': HTMLAttributes.bgColor || '',
        'data-text-color': HTMLAttributes.textColor || '',
        'data-border-color': HTMLAttributes.borderColor || ''
      },
      ...children
    ];
  },
  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'doc-block-wrapper doc-block-columns';

      const is3 = Number(node.attrs.cols) === 3;

      const openEdit = () => {
        if (window.PaklanceEditorUI && typeof window.PaklanceEditorUI.openBlockEditModal === 'function') {
          window.PaklanceEditorUI.openBlockEditModal('blogColumns', node.attrs, (newAttrs) => {
            updateNodeAttrs(editor, getPos, node, newAttrs);
          });
        }
      };

      const openColor = () => {
        if (window.PaklanceEditorUI && typeof window.PaklanceEditorUI.openBlockColorModal === 'function') {
          window.PaklanceEditorUI.openBlockColorModal('blogColumns', node.attrs, (newAttrs) => {
            updateNodeAttrs(editor, getPos, node, newAttrs);
          });
        }
      };

      const toolbar = createBlockControls(
        is3 ? '3-COLUMN LAYOUT' : '2-COLUMN LAYOUT',
        () => moveBlockNode(editor, getPos, node, 'up'),
        () => moveBlockNode(editor, getPos, node, 'down'),
        () => duplicateBlockNode(editor, getPos, node),
        () => deleteBlockNode(editor, getPos, node),
        openEdit,
        openColor
      );
      dom.appendChild(toolbar);

      const row = document.createElement('div');
      row.className = is3 ? 'blog-columns blog-cols-3' : 'blog-columns blog-cols-2';

      const col1 = document.createElement('div');
      col1.className = 'blog-col';
      col1.setAttribute('contenteditable', 'true');
      col1.innerHTML = node.attrs.col1 || '';
      applyBlockCustomColors(col1, node.attrs);
      col1.onblur = () => {
        updateNodeAttrs(editor, getPos, node, { col1: col1.innerHTML });
      };
      row.appendChild(col1);

      const col2 = document.createElement('div');
      col2.className = 'blog-col';
      col2.setAttribute('contenteditable', 'true');
      col2.innerHTML = node.attrs.col2 || '';
      applyBlockCustomColors(col2, node.attrs);
      col2.onblur = () => {
        updateNodeAttrs(editor, getPos, node, { col2: col2.innerHTML });
      };
      row.appendChild(col2);

      let col3 = null;
      if (is3) {
        col3 = document.createElement('div');
        col3.className = 'blog-col';
        col3.setAttribute('contenteditable', 'true');
        col3.innerHTML = node.attrs.col3 || '';
        applyBlockCustomColors(col3, node.attrs);
        col3.onblur = () => {
          updateNodeAttrs(editor, getPos, node, { col3: col3.innerHTML });
        };
        row.appendChild(col3);
      }

      dom.appendChild(row);

      dom.onclick = () => {
        document.querySelectorAll('.doc-block-wrapper').forEach(w => w.classList.remove('is-selected'));
        dom.classList.add('is-selected');
      };

      return {
        dom,
        stopEvent: (event) => {
          const target = event.target;
          return target.isContentEditable || ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target.tagName);
        },
        ignoreMutation: () => true,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'blogColumns') return false;
          if (dom.contains(document.activeElement)) return true;
          applyBlockCustomColors(col1, updatedNode.attrs);
          applyBlockCustomColors(col2, updatedNode.attrs);
          if (col1.innerHTML !== updatedNode.attrs.col1) col1.innerHTML = updatedNode.attrs.col1 || '';
          if (col2.innerHTML !== updatedNode.attrs.col2) col2.innerHTML = updatedNode.attrs.col2 || '';
          if (col3) {
            applyBlockCustomColors(col3, updatedNode.attrs);
            if (col3.innerHTML !== updatedNode.attrs.col3) col3.innerHTML = updatedNode.attrs.col3 || '';
          }
          return true;
        }
      };
    };
  }
});

// 7. Blog Numbered Steps (Workflow Process + Colors)
const BlogSteps = Node.create({
  name: 'blogSteps',
  group: 'block',
  selectable: true,
  draggable: true,
  isolating: true,
  addAttributes() {
    return {
      step1Title: { default: 'Scope Definition & SafePay Escrow' },
      step1Desc: { default: 'Clients post project requirements and fund milestone escrow securely in PKR before work commences.' },
      step2Title: { default: 'Deliverable Production & Reviews' },
      step2Desc: { default: 'Pre-screened Pakistani specialists submit deliverables through direct collaboration channels.' },
      step3Title: { default: 'Instant Milestone Release' },
      step3Desc: { default: 'Approved funds disburse immediately via Raast, EasyPaisa, JazzCash, or direct bank transfer.' },
      bgColor: { default: '' },
      textColor: { default: '' },
      borderColor: { default: '' }
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div.blog-workflow-steps',
        getAttrs: (dom) => {
          const items = dom.querySelectorAll('.blog-step-item');
          const s1 = items[0], s2 = items[1], s3 = items[2];
          return {
            step1Title: s1 ? (s1.querySelector('strong')?.innerText || '') : '',
            step1Desc: s1 ? (s1.querySelector('p')?.innerHTML || '') : '',
            step2Title: s2 ? (s2.querySelector('strong')?.innerText || '') : '',
            step2Desc: s2 ? (s2.querySelector('p')?.innerHTML || '') : '',
            step3Title: s3 ? (s3.querySelector('strong')?.innerText || '') : '',
            step3Desc: s3 ? (s3.querySelector('p')?.innerHTML || '') : '',
            bgColor: dom.getAttribute('data-bg-color') || dom.style.backgroundColor || '',
            textColor: dom.getAttribute('data-text-color') || dom.style.color || '',
            borderColor: dom.getAttribute('data-border-color') || dom.style.borderColor || ''
          };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const itemStyle = getStyleStringForColors(HTMLAttributes);
    return [
      'div',
      {
        class: 'blog-workflow-steps',
        'data-bg-color': HTMLAttributes.bgColor || '',
        'data-text-color': HTMLAttributes.textColor || '',
        'data-border-color': HTMLAttributes.borderColor || ''
      },
      [
        'div',
        { class: 'blog-step-item', style: itemStyle || undefined },
        ['div', { class: 'blog-step-num' }, '1'],
        [
          'div',
          { class: 'blog-step-content' },
          ['strong', {}, HTMLAttributes.step1Title || ''],
          ['p', {}, HTMLAttributes.step1Desc || '']
        ]
      ],
      [
        'div',
        { class: 'blog-step-item', style: itemStyle || undefined },
        ['div', { class: 'blog-step-num' }, '2'],
        [
          'div',
          { class: 'blog-step-content' },
          ['strong', {}, HTMLAttributes.step2Title || ''],
          ['p', {}, HTMLAttributes.step2Desc || '']
        ]
      ],
      [
        'div',
        { class: 'blog-step-item', style: itemStyle || undefined },
        ['div', { class: 'blog-step-num' }, '3'],
        [
          'div',
          { class: 'blog-step-content' },
          ['strong', {}, HTMLAttributes.step3Title || ''],
          ['p', {}, HTMLAttributes.step3Desc || '']
        ]
      ]
    ];
  },
  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'doc-block-wrapper doc-block-steps';

      const openEdit = () => {
        if (window.PaklanceEditorUI && typeof window.PaklanceEditorUI.openBlockEditModal === 'function') {
          window.PaklanceEditorUI.openBlockEditModal('blogSteps', node.attrs, (newAttrs) => {
            updateNodeAttrs(editor, getPos, node, newAttrs);
          });
        }
      };

      const openColor = () => {
        if (window.PaklanceEditorUI && typeof window.PaklanceEditorUI.openBlockColorModal === 'function') {
          window.PaklanceEditorUI.openBlockColorModal('blogSteps', node.attrs, (newAttrs) => {
            updateNodeAttrs(editor, getPos, node, newAttrs);
          });
        }
      };

      const toolbar = createBlockControls(
        'NUMBERED WORKFLOW STEPS',
        () => moveBlockNode(editor, getPos, node, 'up'),
        () => moveBlockNode(editor, getPos, node, 'down'),
        () => duplicateBlockNode(editor, getPos, node),
        () => deleteBlockNode(editor, getPos, node),
        openEdit,
        openColor
      );
      dom.appendChild(toolbar);

      const stepsDiv = document.createElement('div');
      stepsDiv.className = 'blog-workflow-steps';

      const sData = [
        { num: '1', titleKey: 'step1Title', descKey: 'step1Desc' },
        { num: '2', titleKey: 'step2Title', descKey: 'step2Desc' },
        { num: '3', titleKey: 'step3Title', descKey: 'step3Desc' }
      ];

      const itemEls = [];
      sData.forEach(item => {
        const step = document.createElement('div');
        step.className = 'blog-step-item';
        applyBlockCustomColors(step, node.attrs);

        const numBadge = document.createElement('div');
        numBadge.className = 'blog-step-num';
        numBadge.textContent = item.num;
        step.appendChild(numBadge);

        const content = document.createElement('div');
        content.className = 'blog-step-content';

        const strong = document.createElement('strong');
        strong.setAttribute('contenteditable', 'true');
        strong.textContent = node.attrs[item.titleKey] || '';
        strong.onblur = () => {
          updateNodeAttrs(editor, getPos, node, { [item.titleKey]: strong.textContent });
        };
        content.appendChild(strong);

        const p = document.createElement('p');
        p.setAttribute('contenteditable', 'true');
        p.innerHTML = node.attrs[item.descKey] || '';
        p.onblur = () => {
          updateNodeAttrs(editor, getPos, node, { [item.descKey]: p.innerHTML });
        };
        content.appendChild(p);

        step.appendChild(content);
        stepsDiv.appendChild(step);
        itemEls.push({ step, strong, p, item });
      });

      dom.appendChild(stepsDiv);

      dom.onclick = () => {
        document.querySelectorAll('.doc-block-wrapper').forEach(w => w.classList.remove('is-selected'));
        dom.classList.add('is-selected');
      };

      return {
        dom,
        stopEvent: (event) => {
          const target = event.target;
          return target.isContentEditable || ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target.tagName);
        },
        ignoreMutation: () => true,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'blogSteps') return false;
          if (dom.contains(document.activeElement)) return true;
          itemEls.forEach(({ step, strong, p, item }) => {
            applyBlockCustomColors(step, updatedNode.attrs);
            if (strong.textContent !== updatedNode.attrs[item.titleKey]) strong.textContent = updatedNode.attrs[item.titleKey] || '';
            if (p.innerHTML !== updatedNode.attrs[item.descKey]) p.innerHTML = updatedNode.attrs[item.descKey] || '';
          });
          return true;
        }
      };
    };
  }
});

// 8. Blog Section Divider
const BlogDivider = Node.create({
  name: 'blogDivider',
  group: 'block',
  selectable: true,
  draggable: true,
  isolating: true,
  parseHTML() {
    return [
      { tag: 'hr.blog-divider' },
      { tag: 'hr' }
    ];
  },
  renderHTML() {
    return ['hr', { class: 'blog-divider' }];
  },
  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'doc-block-wrapper doc-block-divider';

      const toolbar = createBlockControls(
        'SECTION DIVIDER',
        () => moveBlockNode(editor, getPos, node, 'up'),
        () => moveBlockNode(editor, getPos, node, 'down'),
        () => duplicateBlockNode(editor, getPos, node),
        () => deleteBlockNode(editor, getPos, node)
      );
      dom.appendChild(toolbar);

      const hr = document.createElement('hr');
      hr.className = 'blog-divider';
      dom.appendChild(hr);

      dom.onclick = () => {
        document.querySelectorAll('.doc-block-wrapper').forEach(w => w.classList.remove('is-selected'));
        dom.classList.add('is-selected');
      };

      return { dom };
    };
  }
});

// 9. Blog Source Note (+ Colors)
const BlogSourceNote = Node.create({
  name: 'blogSourceNote',
  group: 'block',
  selectable: true,
  draggable: true,
  isolating: true,
  addAttributes() {
    return {
      text: { default: 'Paklance Platform Benchmarks 2026. Data verified against active marketplace escrow and payout ledgers.' },
      bgColor: { default: '' },
      textColor: { default: '' },
      borderColor: { default: '' }
    };
  },
  parseHTML() {
    return [
      {
        tag: 'aside.blog-source-note',
        getAttrs: (dom) => {
          const p = dom.querySelector('p');
          let text = p ? p.innerHTML : dom.innerHTML;
          text = text.split('Source Note:').pop();
          return {
            text: text ? text.trim() : '',
            bgColor: dom.getAttribute('data-bg-color') || dom.style.backgroundColor || '',
            textColor: dom.getAttribute('data-text-color') || dom.style.color || '',
            borderColor: dom.getAttribute('data-border-color') || dom.style.borderColor || ''
          };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const customStyle = getStyleStringForColors(HTMLAttributes);
    return [
      'aside',
      {
        class: 'blog-source-note',
        'data-bg-color': HTMLAttributes.bgColor || '',
        'data-text-color': HTMLAttributes.textColor || '',
        'data-border-color': HTMLAttributes.borderColor || '',
        style: customStyle || undefined
      },
      ['p', {}, ['strong', {}, 'Source Note: '], HTMLAttributes.text || '']
    ];
  },
  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'doc-block-wrapper doc-block-source';

      const openEdit = () => {
        if (window.PaklanceEditorUI && typeof window.PaklanceEditorUI.openBlockEditModal === 'function') {
          window.PaklanceEditorUI.openBlockEditModal('blogSourceNote', node.attrs, (newAttrs) => {
            updateNodeAttrs(editor, getPos, node, newAttrs);
          });
        }
      };

      const openColor = () => {
        if (window.PaklanceEditorUI && typeof window.PaklanceEditorUI.openBlockColorModal === 'function') {
          window.PaklanceEditorUI.openBlockColorModal('blogSourceNote', node.attrs, (newAttrs) => {
            updateNodeAttrs(editor, getPos, node, newAttrs);
          });
        }
      };

      const toolbar = createBlockControls(
        'SOURCE / ATTRIBUTION NOTE',
        () => moveBlockNode(editor, getPos, node, 'up'),
        () => moveBlockNode(editor, getPos, node, 'down'),
        () => duplicateBlockNode(editor, getPos, node),
        () => deleteBlockNode(editor, getPos, node),
        openEdit,
        openColor
      );
      dom.appendChild(toolbar);

      const aside = document.createElement('aside');
      aside.className = 'blog-source-note';
      applyBlockCustomColors(aside, node.attrs);

      const p = document.createElement('p');
      p.innerHTML = '<strong>Source Note: </strong><span contenteditable="true" class="source-note-text">' + (node.attrs.text || '') + '</span>';
      const span = p.querySelector('.source-note-text');
      span.onblur = () => {
        updateNodeAttrs(editor, getPos, node, { text: span.innerHTML });
      };
      aside.appendChild(p);

      dom.appendChild(aside);

      dom.onclick = () => {
        document.querySelectorAll('.doc-block-wrapper').forEach(w => w.classList.remove('is-selected'));
        dom.classList.add('is-selected');
      };

      return {
        dom,
        stopEvent: (event) => {
          const target = event.target;
          return target.isContentEditable || ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target.tagName);
        },
        ignoreMutation: () => true,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'blogSourceNote') return false;
          if (dom.contains(document.activeElement)) return true;
          applyBlockCustomColors(aside, updatedNode.attrs);
          if (span && span.innerHTML !== updatedNode.attrs.text) span.innerHTML = updatedNode.attrs.text || '';
          return true;
        }
      };
    };
  }
});

// Export master bundle
window.PaklanceEditorBundle = {
  Editor,
  StarterKit,
  BlogTable,
  TableRow,
  TableCell,
  TableHeader,
  Underline,
  TextAlign,
  Link,
  Placeholder,
  BlogFigure,
  BlogQuote,
  BlogTip,
  BlogStats,
  BlogColumns,
  BlogSteps,
  BlogDivider,
  BlogSourceNote
};
`;

const vendorDir = path.join(__dirname, '..', 'public', 'assets', 'vendor');
if (!fs.existsSync(vendorDir)) {
  fs.mkdirSync(vendorDir, { recursive: true });
}

esbuild.build({
  stdin: {
    contents: editorSource,
    resolveDir: path.join(__dirname, '..')
  },
  bundle: true,
  format: 'iife',
  minify: true,
  outfile: path.join(vendorDir, 'editor.bundle.js')
}).then(() => {
  const stat = fs.statSync(path.join(vendorDir, 'editor.bundle.js'));
  console.log('Successfully built TipTap Editor Bundle: ' + stat.size + ' bytes');
}).catch(err => {
  console.error('Editor bundle failed:', err);
  process.exit(1);
});
