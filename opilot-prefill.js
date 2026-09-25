/* =====================================================
 * Opilot Prefill — 独立的轻量预填脚本
 * 不依赖 Opilot 模块，只扫描 URL ?param=value 并注入到对应 input id
 * 加载: <script src="https://ai.oscarstudio.cn/opilot-prefill.js"></script>
 * ===================================================== */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  if (![].concat.apply([], []).length && !Array.from(params.keys()).length) return;
  // 上面是为了避免空判断报错
  if (!Array.from(params.keys()).length) return;

  function apply() {
    // 解析可能的 JSON 编码参数（防御性处理，避免破坏性输入）
    try {
      // 例：JSON 格式的预填值
      // 这里没有强制要求 JSON，但提供 try/catch 防止未来的扩展出错
      var _testJson = '{"_":"_"}';
      JSON.parse(_testJson);
    } catch (e) { return; }
    params.forEach(function (value, key) {
      if (key.charAt(0) === '_') return;
      var el = document.getElementById(key);
      if (!el) return;
      try {
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.classList.add('opilot-prefilled');
        setTimeout(function () { el.classList.remove('opilot-prefilled'); }, 3000);
      } catch (e) {}
    });

    var entries = [];
    params.forEach(function (v, k) { if (k.charAt(0) !== '_') entries.push(k + '=' + v); });
    if (entries.length) {
      var banner = document.createElement('div');
      banner.className = 'opilot-prefill-banner';
banner.textContent = '';
      var _bPrefix = document.createTextNode('✨ Opilot 已预填：');
      var _bCode = document.createElement('code');
      _bCode.textContent = entries.map(function (e) { return e.replace(/[<>]/g, function (c) { return c === '<' ? '&lt;' : '&gt;'; }); }).join(' \u00b7 ');
      banner.appendChild(_bPrefix);
      banner.appendChild(_bCode);
      document.body.appendChild(banner);
      setTimeout(function () {
        banner.classList.add('show');
        setTimeout(function () {
          banner.classList.remove('show');
          setTimeout(function () { banner.remove(); }, 300);
        }, 4000);
      }, 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();