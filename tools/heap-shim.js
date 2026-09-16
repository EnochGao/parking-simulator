/* 最小二叉堆（solver/lv09_rescue 共用结构） */
'use strict';
function Heap() { this.a = []; }
Heap.prototype.push = function (n) {
  var a = this.a; a.push(n); var i = a.length - 1;
  while (i > 0) { var p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; var t = a[p]; a[p] = a[i]; a[i] = t; i = p; }
};
Heap.prototype.pop = function () {
  var a = this.a, top = a[0], last = a.pop();
  if (a.length) {
    a[0] = last; var i = 0;
    for (;;) {
      var l = 2 * i + 1, r = l + 1, m = i;
      if (l < a.length && a[l].f < a[m].f) m = l;
      if (r < a.length && a[r].f < a[m].f) m = r;
      if (m === i) break;
      var t = a[m]; a[m] = a[i]; a[i] = t; i = m;
    }
  }
  return top;
};
Object.defineProperty(Heap.prototype, 'size', { get: function () { return this.a.length; } });
module.exports = Heap;
