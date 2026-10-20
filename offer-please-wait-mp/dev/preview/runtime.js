/**
 * 小程序页面预览器（仅开发用）
 *
 * 它不重新实现业务，而是把真实的 WXML / WXSS / 页面 JS 拿到浏览器里跑：
 *  - WXML 用一个小解析器转成 AST，再按 data 渲染成 DOM；
 *  - 页面 JS 原样加载，提供 Page / setData / wx.* 的浏览器实现；
 *  - WXSS 原样注入，只把 rpx 换算成 px，并把 page 选择器映射到容器。
 *
 * 目的：没有微信开发者工具时，也能看到真实页面、截图、改样式。
 * 它不替代真机：生命周期、原生组件层级、tabBar 行为仍以真机为准。
 */

(function () {
  var ROOT_SEL = '#root';

  /* ================= WXML 解析 ================= */

  function parseWXML(src) {
    src = String(src).replace(/<!--[\s\S]*?-->/g, '');
    var root = { type: 'root', children: [] };
    var stack = [root];
    var i = 0;

    function top() {
      return stack[stack.length - 1];
    }

    while (i < src.length) {
      if (src[i] === '<') {
        if (src[i + 1] === '/') {
          var close = src.indexOf('>', i);
          i = close + 1;
          if (stack.length > 1) stack.pop();
          continue;
        }

        var j = i + 1;
        var name = '';
        while (j < src.length && /[\w-]/.test(src[j])) name += src[j++];

        var node = { type: 'el', tag: name, attrs: {}, children: [] };
        var selfClose = false;

        while (j < src.length) {
          while (j < src.length && /\s/.test(src[j])) j++;
          if (src[j] === '/') {
            j++;
            if (src[j] === '>') j++;
            selfClose = true;
            break;
          }
          if (src[j] === '>') {
            j++;
            break;
          }

          var an = '';
          while (j < src.length && !/[\s=\/>]/.test(src[j])) an += src[j++];

          var av = true;
          if (src[j] === '=') {
            j++;
            var q = src[j];
            if (q === '"' || q === "'") {
              j++;
              var v = '';
              while (j < src.length && src[j] !== q) v += src[j++];
              j++;
              av = v;
            } else {
              var v2 = '';
              while (j < src.length && !/[\s>]/.test(src[j])) v2 += src[j++];
              av = v2;
            }
          }
          if (an) node.attrs[an] = av;
        }

        top().children.push(node);
        if (!selfClose) stack.push(node);
        i = j;
        continue;
      }

      var k = i;
      var text = '';
      while (k < src.length && src[k] !== '<') text += src[k++];
      if (text.trim()) top().children.push({ type: 'text', text: text });
      i = k;
    }

    return root;
  }

  /* ================= 表达式 ================= */

  var exprCache = {};

  function evalExpr(expr, scope) {
    var fn = exprCache[expr];
    if (!fn) {
      try {
        fn = new Function('__s', 'with (__s) { return (' + expr + '); }');
      } catch (e) {
        fn = function () {
          return undefined;
        };
      }
      exprCache[expr] = fn;
    }
    try {
      return fn(scope);
    } catch (e) {
      return undefined;
    }
  }

  function interpolate(str, scope) {
    if (typeof str !== 'string' || str.indexOf('{{') < 0) return str;
    return str.replace(/\{\{([\s\S]*?)\}\}/g, function (m, e) {
      var v = evalExpr(e, scope);
      return v === undefined || v === null ? '' : String(v);
    });
  }

  function truthy(v) {
    return !(v === undefined || v === null || v === false || v === '' || v === 0);
  }

  /** 属性里的表达式：整体是 {{...}} 就求值，否则按模板插值 */
  function evalAttr(raw, scope) {
    if (typeof raw !== 'string') return raw;
    var m = /^\s*\{\{([\s\S]*)\}\}\s*$/.exec(raw);
    if (m) return evalExpr(m[1].trim(), scope);
    return interpolate(raw, scope);
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ================= 渲染 ================= */

  var TAG_MAP = { view: 'div', text: 'span', block: null, textarea: 'textarea', input: 'input', picker: 'select', image: 'img', button: 'button' };

  function renderChildren(nodes, scope) {
    var out = '';
    var chain = null;

    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];

      if (n.type === 'text') {
        out += esc(interpolate(n.text, scope));
        continue;
      }

      var a = n.attrs;

      if (a['wx:if'] !== undefined) {
        var okIf = truthy(evalAttr(a['wx:if'], scope));
        chain = okIf ? 'done' : 'pending';
        if (!okIf) continue;
      } else if (a['wx:elif'] !== undefined) {
        if (chain === 'done') continue;
        var okElif = truthy(evalAttr(a['wx:elif'], scope));
        if (okElif) chain = 'done';
        else continue;
      } else if (a['wx:else'] !== undefined) {
        if (chain === 'done') continue;
        chain = null;
      } else {
        chain = null;
      }

      if (a['wx:for'] !== undefined) {
        var list = evalAttr(a['wx:for'], scope) || [];
        var itemName = a['wx:for-item'] || 'item';
        if (!Array.isArray(list)) list = [];
        for (var k = 0; k < list.length; k++) {
          var child = Object.create(scope);
          child[itemName] = list[k];
          child.index = k;
          out += renderEl(n, child);
        }
        continue;
      }

      out += renderEl(n, scope);
    }

    return out;
  }

  function renderEl(n, scope) {
    var a = n.attrs;

    if (n.tag === 'block') return renderChildren(n.children, scope);

    var tag = TAG_MAP[n.tag];
    if (tag === undefined) tag = 'div';

    var cls = 'wx-' + n.tag;
    if (a['class']) cls += ' ' + interpolate(a['class'], scope);

    var attrs = ' class="' + esc(cls) + '"';
    if (a['style']) attrs += ' style="' + esc(interpolate(a['style'], scope)) + '"';

    Object.keys(a).forEach(function (key) {
      if (key.indexOf('data-') === 0) attrs += ' ' + key + '="' + esc(a[key]) + '"';
      if (key === 'bindtap' || key === 'catchtap') attrs += ' data-ev-click="' + esc(a[key]) + '"';
      if (key === 'bindinput') attrs += ' data-ev-input="' + esc(a[key]) + '"';
      if (key === 'bindchange') attrs += ' data-ev-change="' + esc(a[key]) + '"';
    });

    if (n.tag === 'picker') {
      var range = evalAttr(a.range, scope) || [];
      var val = Number(evalAttr(a.value, scope)) || 0;
      var opts = '';
      for (var i = 0; i < range.length; i++) {
        opts += '<option value="' + i + '"' + (i === val ? ' selected' : '') + '>' + esc(range[i]) + '</option>';
      }
      return '<select' + attrs + '>' + opts + '</select>';
    }

    if (n.tag === 'textarea') {
      if (a.placeholder) attrs += ' placeholder="' + esc(interpolate(a.placeholder, scope)) + '"';
      if (a.maxlength) attrs += ' maxlength="' + esc(interpolate(a.maxlength, scope)) + '"';
      var tv = a.value ? interpolate(a.value, scope) : '';
      return '<textarea' + attrs + '>' + esc(tv) + '</textarea>';
    }

    if (n.tag === 'input') {
      if (a.placeholder) attrs += ' placeholder="' + esc(interpolate(a.placeholder, scope)) + '"';
      if (a.maxlength) attrs += ' maxlength="' + esc(interpolate(a.maxlength, scope)) + '"';
      if (a.value) attrs += ' value="' + esc(interpolate(a.value, scope)) + '"';
      return '<input' + attrs + ' />';
    }

    return '<' + tag + attrs + '>' + renderChildren(n.children, scope) + '</' + tag + '>';
  }

  /* ================= 模块加载 ================= */

  var SOURCES = {};
  var MODULES = {};

  function normalize(base, rel) {
    var parts = (base ? base.split('/').slice(0, -1) : []).concat(rel.split('/'));
    var out = [];
    parts.forEach(function (p) {
      if (p === '.' || p === '') return;
      if (p === '..') out.pop();
      else out.push(p);
    });
    var path = out.join('/');
    return /\.js$/.test(path) ? path : path + '.js';
  }

  function makeRequire(from) {
    return function (rel) {
      var id = normalize(from, rel);
      if (MODULES[id]) return MODULES[id].exports;
      var src = SOURCES[id];
      if (src === undefined) throw new Error('模块不存在：' + id + '（from ' + from + '）');
      var module = { exports: {} };
      MODULES[id] = module;
      var fn = new Function('require', 'module', 'exports', 'wx', src);
      fn(makeRequire(id), module, module.exports, window.wx);
      return module.exports;
    };
  }

  function loadModule(id) {
    if (MODULES[id]) return MODULES[id].exports;
    var src = SOURCES[id];
    if (src === undefined) throw new Error('模块不存在：' + id);
    var module = { exports: {} };
    MODULES[id] = module;
    var fn = new Function('require', 'module', 'exports', 'wx', src);
    pendingPagePath = id;
    fn(makeRequire(id), module, module.exports, window.wx);
    return module.exports;
  }

  /* ================= 运行时 ================= */

  var pageDefs = {};
  var pendingPagePath = '';
  var current = null;
  var history = [];
  var suppressRender = false;
  var renderQueued = false;

  window.Page = function (def) {
    pageDefs[pendingPagePath] = def;
  };
  window.App = function () {};
  window.getApp = function () {
    return {};
  };

  function applyPatch(data, patch) {
    Object.keys(patch).forEach(function (key) {
      var parts = key.split('.');
      var cur = data;
      for (var i = 0; i < parts.length - 1; i++) {
        if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = patch[key];
    });
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(function () {
      renderQueued = false;
      renderNow();
    }, 0);
  }

  function renderNow() {
    if (!current) return;
    var ast = current.ast;
    var html = renderChildren(ast.children, current.inst.data);
    document.querySelector(ROOT_SEL).innerHTML = html;
  }

  function instantiate(def, path) {
    var inst = {};
    Object.keys(def).forEach(function (k) {
      inst[k] = def[k];
    });
    inst.data = JSON.parse(JSON.stringify(def.data || {}));
    inst.setData = function (patch, cb) {
      applyPatch(this.data, patch);
      if (!suppressRender) scheduleRender();
      if (cb) cb();
    };
    inst.route = path;
    return inst;
  }

  function findHandler(name) {
    if (!current) return null;
    var fn = current.inst[name];
    return typeof fn === 'function' ? fn : null;
  }

  function datasetOf(el) {
    var ds = {};
    Object.keys(el.dataset || {}).forEach(function (k) {
      ds[k] = el.dataset[k];
    });
    return ds;
  }

  function bindEvents() {
    var root = document.querySelector(ROOT_SEL);

    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-ev-click]');
      if (!el) return;
      var fn = findHandler(el.getAttribute('data-ev-click'));
      if (fn) fn.call(current.inst, { currentTarget: { dataset: datasetOf(el) }, target: { dataset: datasetOf(el) } });
    });

    root.addEventListener('input', function (e) {
      var el = e.target;
      var name = el.getAttribute('data-ev-input');
      if (!name) return;
      var fn = findHandler(name);
      if (!fn) return;
      suppressRender = true;
      fn.call(current.inst, {
        detail: { value: el.value },
        currentTarget: { dataset: datasetOf(el) },
        target: { dataset: datasetOf(el) }
      });
      suppressRender = false;
    });

    root.addEventListener('change', function (e) {
      var el = e.target;
      var name = el.getAttribute('data-ev-change');
      if (!name) return;
      var fn = findHandler(name);
      if (fn) fn.call(current.inst, { detail: { value: el.value }, currentTarget: { dataset: datasetOf(el) } });
    });
  }

  /* ================= wx.* 模拟 ================= */

  var toastTimer = null;
  var modalEl = null;

  function showToast(opt) {
    var el = document.getElementById('toast');
    el.textContent = opt.title || '';
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('on');
    }, 2000);
  }

  function showModal(opt) {
    if (modalEl) modalEl.remove();
    modalEl = document.createElement('div');
    modalEl.className = 'modal';

    var box = document.createElement('div');
    box.className = 'modal-box';

    var title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = opt.title || '';
    box.appendChild(title);

    if (opt.content) {
      var content = document.createElement('div');
      content.className = 'modal-content';
      content.textContent = opt.content;
      box.appendChild(content);
    }

    var input = null;
    if (opt.editable) {
      input = document.createElement('textarea');
      input.className = 'modal-input';
      input.value = opt.content || '';
      input.placeholder = opt.placeholderText || '';
      box.appendChild(input);
    }

    var btns = document.createElement('div');
    btns.className = 'modal-btns';

    var cancel = document.createElement('div');
    cancel.className = 'modal-btn';
    cancel.textContent = opt.cancelText || '取消';
    cancel.onclick = function () {
      modalEl.remove();
      modalEl = null;
      if (opt.success) opt.success({ confirm: false, cancel: true });
    };

    var confirm = document.createElement('div');
    confirm.className = 'modal-btn primary';
    confirm.textContent = opt.confirmText || '确定';
    confirm.onclick = function () {
      var val = input ? input.value : '';
      modalEl.remove();
      modalEl = null;
      if (opt.success) opt.success({ confirm: true, cancel: false, content: val });
    };

    btns.appendChild(cancel);
    btns.appendChild(confirm);
    box.appendChild(btns);
    modalEl.appendChild(box);
    document.body.appendChild(modalEl);
  }

  function parseUrl(url) {
    var idx = url.indexOf('?');
    var path = idx >= 0 ? url.slice(0, idx) : url;
    var query = {};
    if (idx >= 0) {
      url
        .slice(idx + 1)
        .split('&')
        .forEach(function (kv) {
          var p = kv.split('=');
          query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
        });
    }
    return { path: path.replace(/^\//, ''), query: query };
  }

  var wx = {
    getStorageSync: function (k) {
      try {
        var v = localStorage.getItem('preview:' + k);
        return v ? JSON.parse(v) : '';
      } catch (e) {
        return '';
      }
    },
    setStorageSync: function (k, v) {
      try {
        localStorage.setItem('preview:' + k, JSON.stringify(v));
      } catch (e) {}
    },
    removeStorageSync: function (k) {
      try {
        localStorage.removeItem('preview:' + k);
      } catch (e) {}
    },
    showToast: showToast,
    showModal: showModal,
    navigateTo: function (opt) {
      var u = parseUrl(opt.url);
      if (current && current.inst.onHide) current.inst.onHide();
      history.push(current.path);
      mount(u.path, u.query);
    },
    switchTab: function (opt) {
      var u = parseUrl(opt.url);
      if (current && current.inst.onHide) current.inst.onHide();
      history = [];
      mount(u.path, u.query);
    },
    navigateBack: function () {
      if (!history.length) return;
      var prev = history.pop();
      mount(prev, {});
    },
    stopPullDownRefresh: function () {}
  };
  window.wx = wx;

  /* ================= 挂载 ================= */

  var pageCache = {};
  var navTitles = {};

  function syncChrome(path) {
    var titleEl = document.getElementById('navtitle');
    if (titleEl) titleEl.textContent = navTitles[path] || '';

    var tabs = document.querySelectorAll('.ptab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-tab') === path;
      tabs[i].classList.toggle('on', on);
      var img = tabs[i].querySelector('img');
      if (img) img.src = on ? img.getAttribute('data-on') : img.getAttribute('data-off');
    }
  }

  function buildTabs(tabBar) {
    var el = document.getElementById('tabbar');
    if (!el) return;
    if (!tabBar || !tabBar.list) {
      el.style.display = 'none';
      return;
    }

    el.innerHTML = tabBar.list
      .map(function (t) {
        return (
          '<div class="ptab" data-tab="' +
          t.pagePath +
          '"><img src="/' +
          t.iconPath +
          '" data-on="/' +
          t.selectedIconPath +
          '" data-off="/' +
          t.iconPath +
          '" /><span>' +
          t.text +
          '</span></div>'
        );
      })
      .join('');

    el.addEventListener('click', function (e) {
      var item = e.target.closest('[data-tab]');
      if (!item) return;
      wx.switchTab({ url: '/' + item.getAttribute('data-tab') });
    });
  }

  function mount(path, query) {
    var id = path + '.js';

    if (!pageDefs[id]) {
      try {
        loadModule(id);
      } catch (e) {
        document.querySelector(ROOT_SEL).innerHTML = '<pre style="padding:20px;color:#b00">' + esc(e.message) + '\n' + esc(e.stack || '') + '</pre>';
        return;
      }
    }

    var def = pageDefs[id];
    if (!def) {
      document.querySelector(ROOT_SEL).innerHTML = '<pre style="padding:20px">页面未注册：' + esc(path) + '</pre>';
      return;
    }

    var wxml = pageCache[path];
    var ast = parseWXML(wxml);
    var inst = instantiate(def, path);

    current = { path: path, inst: inst, ast: ast };
    document.querySelector(ROOT_SEL).innerHTML = '';
    syncChrome(path);
    window.scrollTo(0, 0);

    if (inst.onLoad) inst.onLoad(query || {});
    if (inst.onShow) inst.onShow();
    scheduleRender();
  }

  /* ================= 启动 ================= */

  function toPx(css, width) {
    var scale = width / 750;
    return css
      .replace(/(-?\d*\.?\d+)rpx/g, function (m, n) {
        return parseFloat(n) * scale + 'px';
      })
      .replace(/(^|\n)(\s*)page(\s*\{)/g, '$1$2' + ROOT_SEL + '$3');
  }

  function fetchText(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('读取失败：' + url);
      return r.text();
    });
  }

  function boot() {
    var root = document.querySelector(ROOT_SEL);

    fetchText('/app.json')
      .then(function (txt) {
        var app = JSON.parse(txt);
        var pages = app.pages || [];
        var tasks = [];

        tasks.push(fetchText('/app.wxss'));
        tasks.push(fetchText('/app.js'));
        tasks.push(fetchText('/utils/api.js'));
        tasks.push(fetchText('/utils/api-error.js'));
        tasks.push(fetchText('/utils/format.js'));
        tasks.push(fetchText('/utils/mock-api.js'));
        tasks.push(fetchText('/utils/seed.js'));

        pages.forEach(function (p) {
          tasks.push(fetchText('/' + p + '.js'));
          tasks.push(fetchText('/' + p + '.wxml'));
          tasks.push(fetchText('/' + p + '.json'));
        });

        return Promise.all(tasks).then(function (res) {
          var idx = 0;
          var appWxss = res[idx++];
          SOURCES['app.js'] = res[idx++];
          SOURCES['utils/api.js'] = res[idx++];
          SOURCES['utils/api-error.js'] = res[idx++];
          SOURCES['utils/format.js'] = res[idx++];
          SOURCES['utils/mock-api.js'] = res[idx++];
          SOURCES['utils/seed.js'] = res[idx++];

          pages.forEach(function (p) {
            SOURCES[p + '.js'] = res[idx++];
            pageCache[p] = res[idx++];
            try {
              navTitles[p] = JSON.parse(res[idx++]).navigationBarTitleText || '';
            } catch (e) {
              navTitles[p] = '';
              idx++;
            }
          });

          var style = document.createElement('style');
          // 用真实容器宽度换算 rpx，而不是窗口宽度（桌面上容器是模拟的手机宽）
          var w = root.clientWidth || window.innerWidth;
          style.textContent = toPx(appWxss, w);
          document.head.appendChild(style);

          // ?me=openid-B 用来模拟另一个用户，配合本地后端做「两个人互相审」
          var search = {};
          (location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
            if (!kv) return;
            var p = kv.split('=');
            search[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
          });
          wx.setStorageSync('__dev_user', search.me || 'openid-A');

          buildTabs(app.tabBar);
          loadModule('app.js');
          bindEvents();

          // 支持 #/pages/detail/detail?id=seed0 直接打开某一页，方便截图
          // 额外参数（仅预览用）：fresh=1 清空演示数据；as=voted 先替当前用户投一票，用来看结果页
          var hash = location.hash || '';
          var target = hash.indexOf('#/') === 0 ? parseUrl(hash.slice(1)) : { path: pages[0], query: {} };

          if (target.query.fresh === '1' || target.query.as === 'voted') {
            try {
              var mockApi = loadModule('utils/mock-api.js');
              mockApi.reset();
              if (target.query.as === 'voted' && target.query.id) {
                mockApi.call('vote.create', {
                  id: target.query.id,
                  choice: 'wait',
                  reason: '按时薪算是降薪，先去要一份近半年的排班记录再签。',
                  answers: [{ seq: 1, text: '汇报人是新来的总监，才来 4 个月' }]
                });
              }
            } catch (e) {
              console.warn('[preview] 预置数据失败', e);
            }
          }

          mount(target.path, target.query);

          window.__preview = {
            go: function (p, q) {
              history = [];
              mount(p, q || {});
            },
            pages: pages
          };
          document.body.setAttribute('data-ready', '1');
        });
      })
      .catch(function (err) {
        root.innerHTML = '<pre style="padding:20px;color:#b00">' + esc(err.message) + '</pre>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
