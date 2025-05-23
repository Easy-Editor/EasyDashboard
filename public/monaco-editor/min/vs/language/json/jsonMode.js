/*!-----------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Version: 0.46.0(21007360cad28648bdf46282a2592cb47c3a7a6f)
 * Released under the MIT license
 * https://github.com/microsoft/monaco-editor/blob/main/LICENSE.txt
 *-----------------------------------------------------------------------------*/
define('vs/language/json/jsonMode', ['require', 'require'], require => {
  'use strict'
  var moduleExports = (() => {
    var wn = Object.create
    var ie = Object.defineProperty
    var In = Object.getOwnPropertyDescriptor
    var xn = Object.getOwnPropertyNames
    var En = Object.getPrototypeOf,
      _n = Object.prototype.hasOwnProperty
    var Sn = (e =>
      typeof require < 'u'
        ? require
        : typeof Proxy < 'u'
          ? new Proxy(e, { get: (t, i) => (typeof require < 'u' ? require : t)[i] })
          : e)(function (e) {
      if (typeof require < 'u') return require.apply(this, arguments)
      throw Error('Dynamic require of "' + e + '" is not supported')
    })
    var Pn = (e, t) => () => (t || e((t = { exports: {} }).exports, t), t.exports),
      An = (e, t) => {
        for (var i in t) ie(e, i, { get: t[i], enumerable: !0 })
      },
      te = (e, t, i, r) => {
        if ((t && typeof t == 'object') || typeof t == 'function')
          for (let n of xn(t))
            !_n.call(e, n) && n !== i && ie(e, n, { get: () => t[n], enumerable: !(r = In(t, n)) || r.enumerable })
        return e
      },
      _e = (e, t, i) => (te(e, t, 'default'), i && te(i, t, 'default')),
      Se = (e, t, i) => (
        (i = e != null ? wn(En(e)) : {}),
        te(t || !e || !e.__esModule ? ie(i, 'default', { value: e, enumerable: !0 }) : i, e)
      ),
      Ln = e => te(ie({}, '__esModule', { value: !0 }), e)
    var Ae = Pn((vr, Pe) => {
      var On = Se(Sn('vs/editor/editor.api'))
      Pe.exports = On
    })
    var hr = {}
    An(hr, {
      CompletionAdapter: () => X,
      DefinitionAdapter: () => Te,
      DiagnosticsAdapter: () => q,
      DocumentColorAdapter: () => Z,
      DocumentFormattingEditProvider: () => G,
      DocumentHighlightAdapter: () => ke,
      DocumentLinkAdapter: () => we,
      DocumentRangeFormattingEditProvider: () => Q,
      DocumentSymbolAdapter: () => $,
      FoldingRangeAdapter: () => ee,
      HoverAdapter: () => Y,
      ReferenceAdapter: () => be,
      RenameAdapter: () => Ce,
      SelectionRangeAdapter: () => ne,
      WorkerManager: () => D,
      fromPosition: () => L,
      fromRange: () => Ie,
      getWorker: () => dr,
      setupMode: () => gr,
      toRange: () => b,
      toTextEdit: () => j,
    })
    var c = {}
    _e(c, Se(Ae()))
    var Wn = 2 * 60 * 1e3,
      D = class {
        constructor(t) {
          ;(this._defaults = t),
            (this._worker = null),
            (this._client = null),
            (this._idleCheckInterval = window.setInterval(() => this._checkIfIdle(), 30 * 1e3)),
            (this._lastUsedTime = 0),
            (this._configChangeListener = this._defaults.onDidChange(() => this._stopWorker()))
        }
        _stopWorker() {
          this._worker && (this._worker.dispose(), (this._worker = null)), (this._client = null)
        }
        dispose() {
          clearInterval(this._idleCheckInterval), this._configChangeListener.dispose(), this._stopWorker()
        }
        _checkIfIdle() {
          if (!this._worker) return
          Date.now() - this._lastUsedTime > Wn && this._stopWorker()
        }
        _getClient() {
          return (
            (this._lastUsedTime = Date.now()),
            this._client ||
              ((this._worker = c.editor.createWebWorker({
                moduleId: 'vs/language/json/jsonWorker',
                label: this._defaults.languageId,
                createData: {
                  languageSettings: this._defaults.diagnosticsOptions,
                  languageId: this._defaults.languageId,
                  enableSchemaRequest: this._defaults.diagnosticsOptions.enableSchemaRequest,
                },
              })),
              (this._client = this._worker.getProxy())),
            this._client
          )
        }
        getLanguageServiceWorker(...t) {
          let i
          return this._getClient()
            .then(r => {
              i = r
            })
            .then(r => {
              if (this._worker) return this._worker.withSyncedResources(t)
            })
            .then(r => i)
        }
      }
    var Le
    ;(function (e) {
      ;(e.MIN_VALUE = -2147483648), (e.MAX_VALUE = 2147483647)
    })(Le || (Le = {}))
    var oe
    ;(function (e) {
      ;(e.MIN_VALUE = 0), (e.MAX_VALUE = 2147483647)
    })(oe || (oe = {}))
    var S
    ;(function (e) {
      function t(r, n) {
        return (
          r === Number.MAX_VALUE && (r = oe.MAX_VALUE),
          n === Number.MAX_VALUE && (n = oe.MAX_VALUE),
          { line: r, character: n }
        )
      }
      e.create = t
      function i(r) {
        var n = r
        return s.objectLiteral(n) && s.uinteger(n.line) && s.uinteger(n.character)
      }
      e.is = i
    })(S || (S = {}))
    var y
    ;(function (e) {
      function t(r, n, a, o) {
        if (s.uinteger(r) && s.uinteger(n) && s.uinteger(a) && s.uinteger(o))
          return { start: S.create(r, n), end: S.create(a, o) }
        if (S.is(r) && S.is(n)) return { start: r, end: n }
        throw new Error('Range#create called with invalid arguments[' + r + ', ' + n + ', ' + a + ', ' + o + ']')
      }
      e.create = t
      function i(r) {
        var n = r
        return s.objectLiteral(n) && S.is(n.start) && S.is(n.end)
      }
      e.is = i
    })(y || (y = {}))
    var pe
    ;(function (e) {
      function t(r, n) {
        return { uri: r, range: n }
      }
      e.create = t
      function i(r) {
        var n = r
        return s.defined(n) && y.is(n.range) && (s.string(n.uri) || s.undefined(n.uri))
      }
      e.is = i
    })(pe || (pe = {}))
    var Oe
    ;(function (e) {
      function t(r, n, a, o) {
        return { targetUri: r, targetRange: n, targetSelectionRange: a, originSelectionRange: o }
      }
      e.create = t
      function i(r) {
        var n = r
        return (
          s.defined(n) &&
          y.is(n.targetRange) &&
          s.string(n.targetUri) &&
          (y.is(n.targetSelectionRange) || s.undefined(n.targetSelectionRange)) &&
          (y.is(n.originSelectionRange) || s.undefined(n.originSelectionRange))
        )
      }
      e.is = i
    })(Oe || (Oe = {}))
    var he
    ;(function (e) {
      function t(r, n, a, o) {
        return { red: r, green: n, blue: a, alpha: o }
      }
      e.create = t
      function i(r) {
        var n = r
        return (
          s.numberRange(n.red, 0, 1) &&
          s.numberRange(n.green, 0, 1) &&
          s.numberRange(n.blue, 0, 1) &&
          s.numberRange(n.alpha, 0, 1)
        )
      }
      e.is = i
    })(he || (he = {}))
    var We
    ;(function (e) {
      function t(r, n) {
        return { range: r, color: n }
      }
      e.create = t
      function i(r) {
        var n = r
        return y.is(n.range) && he.is(n.color)
      }
      e.is = i
    })(We || (We = {}))
    var Re
    ;(function (e) {
      function t(r, n, a) {
        return { label: r, textEdit: n, additionalTextEdits: a }
      }
      e.create = t
      function i(r) {
        var n = r
        return (
          s.string(n.label) &&
          (s.undefined(n.textEdit) || A.is(n)) &&
          (s.undefined(n.additionalTextEdits) || s.typedArray(n.additionalTextEdits, A.is))
        )
      }
      e.is = i
    })(Re || (Re = {}))
    var M
    ;(function (e) {
      ;(e.Comment = 'comment'), (e.Imports = 'imports'), (e.Region = 'region')
    })(M || (M = {}))
    var De
    ;(function (e) {
      function t(r, n, a, o, u) {
        var l = { startLine: r, endLine: n }
        return (
          s.defined(a) && (l.startCharacter = a), s.defined(o) && (l.endCharacter = o), s.defined(u) && (l.kind = u), l
        )
      }
      e.create = t
      function i(r) {
        var n = r
        return (
          s.uinteger(n.startLine) &&
          s.uinteger(n.startLine) &&
          (s.undefined(n.startCharacter) || s.uinteger(n.startCharacter)) &&
          (s.undefined(n.endCharacter) || s.uinteger(n.endCharacter)) &&
          (s.undefined(n.kind) || s.string(n.kind))
        )
      }
      e.is = i
    })(De || (De = {}))
    var me
    ;(function (e) {
      function t(r, n) {
        return { location: r, message: n }
      }
      e.create = t
      function i(r) {
        var n = r
        return s.defined(n) && pe.is(n.location) && s.string(n.message)
      }
      e.is = i
    })(me || (me = {}))
    var O
    ;(function (e) {
      ;(e.Error = 1), (e.Warning = 2), (e.Information = 3), (e.Hint = 4)
    })(O || (O = {}))
    var Ne
    ;(function (e) {
      ;(e.Unnecessary = 1), (e.Deprecated = 2)
    })(Ne || (Ne = {}))
    var Me
    ;(function (e) {
      function t(i) {
        var r = i
        return r != null && s.string(r.href)
      }
      e.is = t
    })(Me || (Me = {}))
    var se
    ;(function (e) {
      function t(r, n, a, o, u, l) {
        var h = { range: r, message: n }
        return (
          s.defined(a) && (h.severity = a),
          s.defined(o) && (h.code = o),
          s.defined(u) && (h.source = u),
          s.defined(l) && (h.relatedInformation = l),
          h
        )
      }
      e.create = t
      function i(r) {
        var n,
          a = r
        return (
          s.defined(a) &&
          y.is(a.range) &&
          s.string(a.message) &&
          (s.number(a.severity) || s.undefined(a.severity)) &&
          (s.integer(a.code) || s.string(a.code) || s.undefined(a.code)) &&
          (s.undefined(a.codeDescription) ||
            s.string((n = a.codeDescription) === null || n === void 0 ? void 0 : n.href)) &&
          (s.string(a.source) || s.undefined(a.source)) &&
          (s.undefined(a.relatedInformation) || s.typedArray(a.relatedInformation, me.is))
        )
      }
      e.is = i
    })(se || (se = {}))
    var K
    ;(function (e) {
      function t(r, n) {
        for (var a = [], o = 2; o < arguments.length; o++) a[o - 2] = arguments[o]
        var u = { title: r, command: n }
        return s.defined(a) && a.length > 0 && (u.arguments = a), u
      }
      e.create = t
      function i(r) {
        var n = r
        return s.defined(n) && s.string(n.title) && s.string(n.command)
      }
      e.is = i
    })(K || (K = {}))
    var A
    ;(function (e) {
      function t(a, o) {
        return { range: a, newText: o }
      }
      e.replace = t
      function i(a, o) {
        return { range: { start: a, end: a }, newText: o }
      }
      e.insert = i
      function r(a) {
        return { range: a, newText: '' }
      }
      e.del = r
      function n(a) {
        var o = a
        return s.objectLiteral(o) && s.string(o.newText) && y.is(o.range)
      }
      e.is = n
    })(A || (A = {}))
    var N
    ;(function (e) {
      function t(r, n, a) {
        var o = { label: r }
        return n !== void 0 && (o.needsConfirmation = n), a !== void 0 && (o.description = a), o
      }
      e.create = t
      function i(r) {
        var n = r
        return (
          n !== void 0 &&
          s.objectLiteral(n) &&
          s.string(n.label) &&
          (s.boolean(n.needsConfirmation) || n.needsConfirmation === void 0) &&
          (s.string(n.description) || n.description === void 0)
        )
      }
      e.is = i
    })(N || (N = {}))
    var T
    ;(function (e) {
      function t(i) {
        var r = i
        return typeof r == 'string'
      }
      e.is = t
    })(T || (T = {}))
    var P
    ;(function (e) {
      function t(a, o, u) {
        return { range: a, newText: o, annotationId: u }
      }
      e.replace = t
      function i(a, o, u) {
        return { range: { start: a, end: a }, newText: o, annotationId: u }
      }
      e.insert = i
      function r(a, o) {
        return { range: a, newText: '', annotationId: o }
      }
      e.del = r
      function n(a) {
        var o = a
        return A.is(o) && (N.is(o.annotationId) || T.is(o.annotationId))
      }
      e.is = n
    })(P || (P = {}))
    var ue
    ;(function (e) {
      function t(r, n) {
        return { textDocument: r, edits: n }
      }
      e.create = t
      function i(r) {
        var n = r
        return s.defined(n) && ce.is(n.textDocument) && Array.isArray(n.edits)
      }
      e.is = i
    })(ue || (ue = {}))
    var H
    ;(function (e) {
      function t(r, n, a) {
        var o = { kind: 'create', uri: r }
        return (
          n !== void 0 && (n.overwrite !== void 0 || n.ignoreIfExists !== void 0) && (o.options = n),
          a !== void 0 && (o.annotationId = a),
          o
        )
      }
      e.create = t
      function i(r) {
        var n = r
        return (
          n &&
          n.kind === 'create' &&
          s.string(n.uri) &&
          (n.options === void 0 ||
            ((n.options.overwrite === void 0 || s.boolean(n.options.overwrite)) &&
              (n.options.ignoreIfExists === void 0 || s.boolean(n.options.ignoreIfExists)))) &&
          (n.annotationId === void 0 || T.is(n.annotationId))
        )
      }
      e.is = i
    })(H || (H = {}))
    var J
    ;(function (e) {
      function t(r, n, a, o) {
        var u = { kind: 'rename', oldUri: r, newUri: n }
        return (
          a !== void 0 && (a.overwrite !== void 0 || a.ignoreIfExists !== void 0) && (u.options = a),
          o !== void 0 && (u.annotationId = o),
          u
        )
      }
      e.create = t
      function i(r) {
        var n = r
        return (
          n &&
          n.kind === 'rename' &&
          s.string(n.oldUri) &&
          s.string(n.newUri) &&
          (n.options === void 0 ||
            ((n.options.overwrite === void 0 || s.boolean(n.options.overwrite)) &&
              (n.options.ignoreIfExists === void 0 || s.boolean(n.options.ignoreIfExists)))) &&
          (n.annotationId === void 0 || T.is(n.annotationId))
        )
      }
      e.is = i
    })(J || (J = {}))
    var B
    ;(function (e) {
      function t(r, n, a) {
        var o = { kind: 'delete', uri: r }
        return (
          n !== void 0 && (n.recursive !== void 0 || n.ignoreIfNotExists !== void 0) && (o.options = n),
          a !== void 0 && (o.annotationId = a),
          o
        )
      }
      e.create = t
      function i(r) {
        var n = r
        return (
          n &&
          n.kind === 'delete' &&
          s.string(n.uri) &&
          (n.options === void 0 ||
            ((n.options.recursive === void 0 || s.boolean(n.options.recursive)) &&
              (n.options.ignoreIfNotExists === void 0 || s.boolean(n.options.ignoreIfNotExists)))) &&
          (n.annotationId === void 0 || T.is(n.annotationId))
        )
      }
      e.is = i
    })(B || (B = {}))
    var ve
    ;(function (e) {
      function t(i) {
        var r = i
        return (
          r &&
          (r.changes !== void 0 || r.documentChanges !== void 0) &&
          (r.documentChanges === void 0 ||
            r.documentChanges.every(function (n) {
              return s.string(n.kind) ? H.is(n) || J.is(n) || B.is(n) : ue.is(n)
            }))
        )
      }
      e.is = t
    })(ve || (ve = {}))
    var ae = (function () {
        function e(t, i) {
          ;(this.edits = t), (this.changeAnnotations = i)
        }
        return (
          (e.prototype.insert = function (t, i, r) {
            var n, a
            if (
              (r === void 0
                ? (n = A.insert(t, i))
                : T.is(r)
                  ? ((a = r), (n = P.insert(t, i, r)))
                  : (this.assertChangeAnnotations(this.changeAnnotations),
                    (a = this.changeAnnotations.manage(r)),
                    (n = P.insert(t, i, a))),
              this.edits.push(n),
              a !== void 0)
            )
              return a
          }),
          (e.prototype.replace = function (t, i, r) {
            var n, a
            if (
              (r === void 0
                ? (n = A.replace(t, i))
                : T.is(r)
                  ? ((a = r), (n = P.replace(t, i, r)))
                  : (this.assertChangeAnnotations(this.changeAnnotations),
                    (a = this.changeAnnotations.manage(r)),
                    (n = P.replace(t, i, a))),
              this.edits.push(n),
              a !== void 0)
            )
              return a
          }),
          (e.prototype.delete = function (t, i) {
            var r, n
            if (
              (i === void 0
                ? (r = A.del(t))
                : T.is(i)
                  ? ((n = i), (r = P.del(t, i)))
                  : (this.assertChangeAnnotations(this.changeAnnotations),
                    (n = this.changeAnnotations.manage(i)),
                    (r = P.del(t, n))),
              this.edits.push(r),
              n !== void 0)
            )
              return n
          }),
          (e.prototype.add = function (t) {
            this.edits.push(t)
          }),
          (e.prototype.all = function () {
            return this.edits
          }),
          (e.prototype.clear = function () {
            this.edits.splice(0, this.edits.length)
          }),
          (e.prototype.assertChangeAnnotations = function (t) {
            if (t === void 0) throw new Error('Text edit change is not configured to manage change annotations.')
          }),
          e
        )
      })(),
      Fe = (function () {
        function e(t) {
          ;(this._annotations = t === void 0 ? Object.create(null) : t), (this._counter = 0), (this._size = 0)
        }
        return (
          (e.prototype.all = function () {
            return this._annotations
          }),
          Object.defineProperty(e.prototype, 'size', {
            get: function () {
              return this._size
            },
            enumerable: !1,
            configurable: !0,
          }),
          (e.prototype.manage = function (t, i) {
            var r
            if ((T.is(t) ? (r = t) : ((r = this.nextId()), (i = t)), this._annotations[r] !== void 0))
              throw new Error('Id ' + r + ' is already in use.')
            if (i === void 0) throw new Error('No annotation provided for id ' + r)
            return (this._annotations[r] = i), this._size++, r
          }),
          (e.prototype.nextId = function () {
            return this._counter++, this._counter.toString()
          }),
          e
        )
      })(),
      wr = (function () {
        function e(t) {
          var i = this
          ;(this._textEditChanges = Object.create(null)),
            t !== void 0
              ? ((this._workspaceEdit = t),
                t.documentChanges
                  ? ((this._changeAnnotations = new Fe(t.changeAnnotations)),
                    (t.changeAnnotations = this._changeAnnotations.all()),
                    t.documentChanges.forEach(function (r) {
                      if (ue.is(r)) {
                        var n = new ae(r.edits, i._changeAnnotations)
                        i._textEditChanges[r.textDocument.uri] = n
                      }
                    }))
                  : t.changes &&
                    Object.keys(t.changes).forEach(function (r) {
                      var n = new ae(t.changes[r])
                      i._textEditChanges[r] = n
                    }))
              : (this._workspaceEdit = {})
        }
        return (
          Object.defineProperty(e.prototype, 'edit', {
            get: function () {
              return (
                this.initDocumentChanges(),
                this._changeAnnotations !== void 0 &&
                  (this._changeAnnotations.size === 0
                    ? (this._workspaceEdit.changeAnnotations = void 0)
                    : (this._workspaceEdit.changeAnnotations = this._changeAnnotations.all())),
                this._workspaceEdit
              )
            },
            enumerable: !1,
            configurable: !0,
          }),
          (e.prototype.getTextEditChange = function (t) {
            if (ce.is(t)) {
              if ((this.initDocumentChanges(), this._workspaceEdit.documentChanges === void 0))
                throw new Error('Workspace edit is not configured for document changes.')
              var i = { uri: t.uri, version: t.version },
                r = this._textEditChanges[i.uri]
              if (!r) {
                var n = [],
                  a = { textDocument: i, edits: n }
                this._workspaceEdit.documentChanges.push(a),
                  (r = new ae(n, this._changeAnnotations)),
                  (this._textEditChanges[i.uri] = r)
              }
              return r
            } else {
              if ((this.initChanges(), this._workspaceEdit.changes === void 0))
                throw new Error('Workspace edit is not configured for normal text edit changes.')
              var r = this._textEditChanges[t]
              if (!r) {
                var n = []
                ;(this._workspaceEdit.changes[t] = n), (r = new ae(n)), (this._textEditChanges[t] = r)
              }
              return r
            }
          }),
          (e.prototype.initDocumentChanges = function () {
            this._workspaceEdit.documentChanges === void 0 &&
              this._workspaceEdit.changes === void 0 &&
              ((this._changeAnnotations = new Fe()),
              (this._workspaceEdit.documentChanges = []),
              (this._workspaceEdit.changeAnnotations = this._changeAnnotations.all()))
          }),
          (e.prototype.initChanges = function () {
            this._workspaceEdit.documentChanges === void 0 &&
              this._workspaceEdit.changes === void 0 &&
              (this._workspaceEdit.changes = Object.create(null))
          }),
          (e.prototype.createFile = function (t, i, r) {
            if ((this.initDocumentChanges(), this._workspaceEdit.documentChanges === void 0))
              throw new Error('Workspace edit is not configured for document changes.')
            var n
            N.is(i) || T.is(i) ? (n = i) : (r = i)
            var a, o
            if (
              (n === void 0
                ? (a = H.create(t, r))
                : ((o = T.is(n) ? n : this._changeAnnotations.manage(n)), (a = H.create(t, r, o))),
              this._workspaceEdit.documentChanges.push(a),
              o !== void 0)
            )
              return o
          }),
          (e.prototype.renameFile = function (t, i, r, n) {
            if ((this.initDocumentChanges(), this._workspaceEdit.documentChanges === void 0))
              throw new Error('Workspace edit is not configured for document changes.')
            var a
            N.is(r) || T.is(r) ? (a = r) : (n = r)
            var o, u
            if (
              (a === void 0
                ? (o = J.create(t, i, n))
                : ((u = T.is(a) ? a : this._changeAnnotations.manage(a)), (o = J.create(t, i, n, u))),
              this._workspaceEdit.documentChanges.push(o),
              u !== void 0)
            )
              return u
          }),
          (e.prototype.deleteFile = function (t, i, r) {
            if ((this.initDocumentChanges(), this._workspaceEdit.documentChanges === void 0))
              throw new Error('Workspace edit is not configured for document changes.')
            var n
            N.is(i) || T.is(i) ? (n = i) : (r = i)
            var a, o
            if (
              (n === void 0
                ? (a = B.create(t, r))
                : ((o = T.is(n) ? n : this._changeAnnotations.manage(n)), (a = B.create(t, r, o))),
              this._workspaceEdit.documentChanges.push(a),
              o !== void 0)
            )
              return o
          }),
          e
        )
      })()
    var je
    ;(function (e) {
      function t(r) {
        return { uri: r }
      }
      e.create = t
      function i(r) {
        var n = r
        return s.defined(n) && s.string(n.uri)
      }
      e.is = i
    })(je || (je = {}))
    var Ue
    ;(function (e) {
      function t(r, n) {
        return { uri: r, version: n }
      }
      e.create = t
      function i(r) {
        var n = r
        return s.defined(n) && s.string(n.uri) && s.integer(n.version)
      }
      e.is = i
    })(Ue || (Ue = {}))
    var ce
    ;(function (e) {
      function t(r, n) {
        return { uri: r, version: n }
      }
      e.create = t
      function i(r) {
        var n = r
        return s.defined(n) && s.string(n.uri) && (n.version === null || s.integer(n.version))
      }
      e.is = i
    })(ce || (ce = {}))
    var Ve
    ;(function (e) {
      function t(r, n, a, o) {
        return { uri: r, languageId: n, version: a, text: o }
      }
      e.create = t
      function i(r) {
        var n = r
        return s.defined(n) && s.string(n.uri) && s.string(n.languageId) && s.integer(n.version) && s.string(n.text)
      }
      e.is = i
    })(Ve || (Ve = {}))
    var z
    ;(function (e) {
      ;(e.PlainText = 'plaintext'), (e.Markdown = 'markdown')
    })(z || (z = {}))
    ;(function (e) {
      function t(i) {
        var r = i
        return r === e.PlainText || r === e.Markdown
      }
      e.is = t
    })(z || (z = {}))
    var ye
    ;(function (e) {
      function t(i) {
        var r = i
        return s.objectLiteral(i) && z.is(r.kind) && s.string(r.value)
      }
      e.is = t
    })(ye || (ye = {}))
    var m
    ;(function (e) {
      ;(e.Text = 1),
        (e.Method = 2),
        (e.Function = 3),
        (e.Constructor = 4),
        (e.Field = 5),
        (e.Variable = 6),
        (e.Class = 7),
        (e.Interface = 8),
        (e.Module = 9),
        (e.Property = 10),
        (e.Unit = 11),
        (e.Value = 12),
        (e.Enum = 13),
        (e.Keyword = 14),
        (e.Snippet = 15),
        (e.Color = 16),
        (e.File = 17),
        (e.Reference = 18),
        (e.Folder = 19),
        (e.EnumMember = 20),
        (e.Constant = 21),
        (e.Struct = 22),
        (e.Event = 23),
        (e.Operator = 24),
        (e.TypeParameter = 25)
    })(m || (m = {}))
    var le
    ;(function (e) {
      ;(e.PlainText = 1), (e.Snippet = 2)
    })(le || (le = {}))
    var Ke
    ;(function (e) {
      e.Deprecated = 1
    })(Ke || (Ke = {}))
    var He
    ;(function (e) {
      function t(r, n, a) {
        return { newText: r, insert: n, replace: a }
      }
      e.create = t
      function i(r) {
        var n = r
        return n && s.string(n.newText) && y.is(n.insert) && y.is(n.replace)
      }
      e.is = i
    })(He || (He = {}))
    var Je
    ;(function (e) {
      ;(e.asIs = 1), (e.adjustIndentation = 2)
    })(Je || (Je = {}))
    var Be
    ;(function (e) {
      function t(i) {
        return { label: i }
      }
      e.create = t
    })(Be || (Be = {}))
    var ze
    ;(function (e) {
      function t(i, r) {
        return { items: i || [], isIncomplete: !!r }
      }
      e.create = t
    })(ze || (ze = {}))
    var fe
    ;(function (e) {
      function t(r) {
        return r.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&')
      }
      e.fromPlainText = t
      function i(r) {
        var n = r
        return s.string(n) || (s.objectLiteral(n) && s.string(n.language) && s.string(n.value))
      }
      e.is = i
    })(fe || (fe = {}))
    var qe
    ;(function (e) {
      function t(i) {
        var r = i
        return (
          !!r &&
          s.objectLiteral(r) &&
          (ye.is(r.contents) || fe.is(r.contents) || s.typedArray(r.contents, fe.is)) &&
          (i.range === void 0 || y.is(i.range))
        )
      }
      e.is = t
    })(qe || (qe = {}))
    var Xe
    ;(function (e) {
      function t(i, r) {
        return r ? { label: i, documentation: r } : { label: i }
      }
      e.create = t
    })(Xe || (Xe = {}))
    var Ye
    ;(function (e) {
      function t(i, r) {
        for (var n = [], a = 2; a < arguments.length; a++) n[a - 2] = arguments[a]
        var o = { label: i }
        return s.defined(r) && (o.documentation = r), s.defined(n) ? (o.parameters = n) : (o.parameters = []), o
      }
      e.create = t
    })(Ye || (Ye = {}))
    var F
    ;(function (e) {
      ;(e.Text = 1), (e.Read = 2), (e.Write = 3)
    })(F || (F = {}))
    var $e
    ;(function (e) {
      function t(i, r) {
        var n = { range: i }
        return s.number(r) && (n.kind = r), n
      }
      e.create = t
    })($e || ($e = {}))
    var v
    ;(function (e) {
      ;(e.File = 1),
        (e.Module = 2),
        (e.Namespace = 3),
        (e.Package = 4),
        (e.Class = 5),
        (e.Method = 6),
        (e.Property = 7),
        (e.Field = 8),
        (e.Constructor = 9),
        (e.Enum = 10),
        (e.Interface = 11),
        (e.Function = 12),
        (e.Variable = 13),
        (e.Constant = 14),
        (e.String = 15),
        (e.Number = 16),
        (e.Boolean = 17),
        (e.Array = 18),
        (e.Object = 19),
        (e.Key = 20),
        (e.Null = 21),
        (e.EnumMember = 22),
        (e.Struct = 23),
        (e.Event = 24),
        (e.Operator = 25),
        (e.TypeParameter = 26)
    })(v || (v = {}))
    var Ge
    ;(function (e) {
      e.Deprecated = 1
    })(Ge || (Ge = {}))
    var Qe
    ;(function (e) {
      function t(i, r, n, a, o) {
        var u = { name: i, kind: r, location: { uri: a, range: n } }
        return o && (u.containerName = o), u
      }
      e.create = t
    })(Qe || (Qe = {}))
    var Ze
    ;(function (e) {
      function t(r, n, a, o, u, l) {
        var h = { name: r, detail: n, kind: a, range: o, selectionRange: u }
        return l !== void 0 && (h.children = l), h
      }
      e.create = t
      function i(r) {
        var n = r
        return (
          n &&
          s.string(n.name) &&
          s.number(n.kind) &&
          y.is(n.range) &&
          y.is(n.selectionRange) &&
          (n.detail === void 0 || s.string(n.detail)) &&
          (n.deprecated === void 0 || s.boolean(n.deprecated)) &&
          (n.children === void 0 || Array.isArray(n.children)) &&
          (n.tags === void 0 || Array.isArray(n.tags))
        )
      }
      e.is = i
    })(Ze || (Ze = {}))
    var en
    ;(function (e) {
      ;(e.Empty = ''),
        (e.QuickFix = 'quickfix'),
        (e.Refactor = 'refactor'),
        (e.RefactorExtract = 'refactor.extract'),
        (e.RefactorInline = 'refactor.inline'),
        (e.RefactorRewrite = 'refactor.rewrite'),
        (e.Source = 'source'),
        (e.SourceOrganizeImports = 'source.organizeImports'),
        (e.SourceFixAll = 'source.fixAll')
    })(en || (en = {}))
    var nn
    ;(function (e) {
      function t(r, n) {
        var a = { diagnostics: r }
        return n != null && (a.only = n), a
      }
      e.create = t
      function i(r) {
        var n = r
        return (
          s.defined(n) && s.typedArray(n.diagnostics, se.is) && (n.only === void 0 || s.typedArray(n.only, s.string))
        )
      }
      e.is = i
    })(nn || (nn = {}))
    var rn
    ;(function (e) {
      function t(r, n, a) {
        var o = { title: r },
          u = !0
        return (
          typeof n == 'string' ? ((u = !1), (o.kind = n)) : K.is(n) ? (o.command = n) : (o.edit = n),
          u && a !== void 0 && (o.kind = a),
          o
        )
      }
      e.create = t
      function i(r) {
        var n = r
        return (
          n &&
          s.string(n.title) &&
          (n.diagnostics === void 0 || s.typedArray(n.diagnostics, se.is)) &&
          (n.kind === void 0 || s.string(n.kind)) &&
          (n.edit !== void 0 || n.command !== void 0) &&
          (n.command === void 0 || K.is(n.command)) &&
          (n.isPreferred === void 0 || s.boolean(n.isPreferred)) &&
          (n.edit === void 0 || ve.is(n.edit))
        )
      }
      e.is = i
    })(rn || (rn = {}))
    var tn
    ;(function (e) {
      function t(r, n) {
        var a = { range: r }
        return s.defined(n) && (a.data = n), a
      }
      e.create = t
      function i(r) {
        var n = r
        return s.defined(n) && y.is(n.range) && (s.undefined(n.command) || K.is(n.command))
      }
      e.is = i
    })(tn || (tn = {}))
    var an
    ;(function (e) {
      function t(r, n) {
        return { tabSize: r, insertSpaces: n }
      }
      e.create = t
      function i(r) {
        var n = r
        return s.defined(n) && s.uinteger(n.tabSize) && s.boolean(n.insertSpaces)
      }
      e.is = i
    })(an || (an = {}))
    var on
    ;(function (e) {
      function t(r, n, a) {
        return { range: r, target: n, data: a }
      }
      e.create = t
      function i(r) {
        var n = r
        return s.defined(n) && y.is(n.range) && (s.undefined(n.target) || s.string(n.target))
      }
      e.is = i
    })(on || (on = {}))
    var sn
    ;(function (e) {
      function t(r, n) {
        return { range: r, parent: n }
      }
      e.create = t
      function i(r) {
        var n = r
        return n !== void 0 && y.is(n.range) && (n.parent === void 0 || e.is(n.parent))
      }
      e.is = i
    })(sn || (sn = {}))
    var un
    ;(function (e) {
      function t(a, o, u, l) {
        return new Rn(a, o, u, l)
      }
      e.create = t
      function i(a) {
        var o = a
        return !!(
          s.defined(o) &&
          s.string(o.uri) &&
          (s.undefined(o.languageId) || s.string(o.languageId)) &&
          s.uinteger(o.lineCount) &&
          s.func(o.getText) &&
          s.func(o.positionAt) &&
          s.func(o.offsetAt)
        )
      }
      e.is = i
      function r(a, o) {
        for (
          var u = a.getText(),
            l = n(o, function (_, R) {
              var V = _.range.start.line - R.range.start.line
              return V === 0 ? _.range.start.character - R.range.start.character : V
            }),
            h = u.length,
            p = l.length - 1;
          p >= 0;
          p--
        ) {
          var f = l[p],
            C = a.offsetAt(f.range.start),
            g = a.offsetAt(f.range.end)
          if (g <= h) u = u.substring(0, C) + f.newText + u.substring(g, u.length)
          else throw new Error('Overlapping edit')
          h = C
        }
        return u
      }
      e.applyEdits = r
      function n(a, o) {
        if (a.length <= 1) return a
        var u = (a.length / 2) | 0,
          l = a.slice(0, u),
          h = a.slice(u)
        n(l, o), n(h, o)
        for (var p = 0, f = 0, C = 0; p < l.length && f < h.length; ) {
          var g = o(l[p], h[f])
          g <= 0 ? (a[C++] = l[p++]) : (a[C++] = h[f++])
        }
        for (; p < l.length; ) a[C++] = l[p++]
        for (; f < h.length; ) a[C++] = h[f++]
        return a
      }
    })(un || (un = {}))
    var Rn = (function () {
        function e(t, i, r, n) {
          ;(this._uri = t),
            (this._languageId = i),
            (this._version = r),
            (this._content = n),
            (this._lineOffsets = void 0)
        }
        return (
          Object.defineProperty(e.prototype, 'uri', {
            get: function () {
              return this._uri
            },
            enumerable: !1,
            configurable: !0,
          }),
          Object.defineProperty(e.prototype, 'languageId', {
            get: function () {
              return this._languageId
            },
            enumerable: !1,
            configurable: !0,
          }),
          Object.defineProperty(e.prototype, 'version', {
            get: function () {
              return this._version
            },
            enumerable: !1,
            configurable: !0,
          }),
          (e.prototype.getText = function (t) {
            if (t) {
              var i = this.offsetAt(t.start),
                r = this.offsetAt(t.end)
              return this._content.substring(i, r)
            }
            return this._content
          }),
          (e.prototype.update = function (t, i) {
            ;(this._content = t.text), (this._version = i), (this._lineOffsets = void 0)
          }),
          (e.prototype.getLineOffsets = function () {
            if (this._lineOffsets === void 0) {
              for (var t = [], i = this._content, r = !0, n = 0; n < i.length; n++) {
                r && (t.push(n), (r = !1))
                var a = i.charAt(n)
                ;(r =
                  a === '\r' ||
                  a ===
                    `
`),
                  a === '\r' &&
                    n + 1 < i.length &&
                    i.charAt(n + 1) ===
                      `
` &&
                    n++
              }
              r && i.length > 0 && t.push(i.length), (this._lineOffsets = t)
            }
            return this._lineOffsets
          }),
          (e.prototype.positionAt = function (t) {
            t = Math.max(Math.min(t, this._content.length), 0)
            var i = this.getLineOffsets(),
              r = 0,
              n = i.length
            if (n === 0) return S.create(0, t)
            for (; r < n; ) {
              var a = Math.floor((r + n) / 2)
              i[a] > t ? (n = a) : (r = a + 1)
            }
            var o = r - 1
            return S.create(o, t - i[o])
          }),
          (e.prototype.offsetAt = function (t) {
            var i = this.getLineOffsets()
            if (t.line >= i.length) return this._content.length
            if (t.line < 0) return 0
            var r = i[t.line],
              n = t.line + 1 < i.length ? i[t.line + 1] : this._content.length
            return Math.max(Math.min(r + t.character, n), r)
          }),
          Object.defineProperty(e.prototype, 'lineCount', {
            get: function () {
              return this.getLineOffsets().length
            },
            enumerable: !1,
            configurable: !0,
          }),
          e
        )
      })(),
      s
    ;(function (e) {
      var t = Object.prototype.toString
      function i(g) {
        return typeof g < 'u'
      }
      e.defined = i
      function r(g) {
        return typeof g > 'u'
      }
      e.undefined = r
      function n(g) {
        return g === !0 || g === !1
      }
      e.boolean = n
      function a(g) {
        return t.call(g) === '[object String]'
      }
      e.string = a
      function o(g) {
        return t.call(g) === '[object Number]'
      }
      e.number = o
      function u(g, _, R) {
        return t.call(g) === '[object Number]' && _ <= g && g <= R
      }
      e.numberRange = u
      function l(g) {
        return t.call(g) === '[object Number]' && -2147483648 <= g && g <= 2147483647
      }
      e.integer = l
      function h(g) {
        return t.call(g) === '[object Number]' && 0 <= g && g <= 2147483647
      }
      e.uinteger = h
      function p(g) {
        return t.call(g) === '[object Function]'
      }
      e.func = p
      function f(g) {
        return g !== null && typeof g == 'object'
      }
      e.objectLiteral = f
      function C(g, _) {
        return Array.isArray(g) && g.every(_)
      }
      e.typedArray = C
    })(s || (s = {}))
    var q = class {
      constructor(t, i, r) {
        this._languageId = t
        this._worker = i
        this._disposables = []
        this._listener = Object.create(null)
        let n = o => {
            let u = o.getLanguageId()
            if (u !== this._languageId) return
            let l
            ;(this._listener[o.uri.toString()] = o.onDidChangeContent(() => {
              window.clearTimeout(l), (l = window.setTimeout(() => this._doValidate(o.uri, u), 500))
            })),
              this._doValidate(o.uri, u)
          },
          a = o => {
            c.editor.setModelMarkers(o, this._languageId, [])
            let u = o.uri.toString(),
              l = this._listener[u]
            l && (l.dispose(), delete this._listener[u])
          }
        this._disposables.push(c.editor.onDidCreateModel(n)),
          this._disposables.push(c.editor.onWillDisposeModel(a)),
          this._disposables.push(
            c.editor.onDidChangeModelLanguage(o => {
              a(o.model), n(o.model)
            }),
          ),
          this._disposables.push(
            r(o => {
              c.editor.getModels().forEach(u => {
                u.getLanguageId() === this._languageId && (a(u), n(u))
              })
            }),
          ),
          this._disposables.push({
            dispose: () => {
              c.editor.getModels().forEach(a)
              for (let o in this._listener) this._listener[o].dispose()
            },
          }),
          c.editor.getModels().forEach(n)
      }
      dispose() {
        this._disposables.forEach(t => t && t.dispose()), (this._disposables.length = 0)
      }
      _doValidate(t, i) {
        this._worker(t)
          .then(r => r.doValidation(t.toString()))
          .then(r => {
            let n = r.map(o => Mn(t, o)),
              a = c.editor.getModel(t)
            a && a.getLanguageId() === i && c.editor.setModelMarkers(a, i, n)
          })
          .then(void 0, r => {
            console.error(r)
          })
      }
    }
    function Nn(e) {
      switch (e) {
        case O.Error:
          return c.MarkerSeverity.Error
        case O.Warning:
          return c.MarkerSeverity.Warning
        case O.Information:
          return c.MarkerSeverity.Info
        case O.Hint:
          return c.MarkerSeverity.Hint
        default:
          return c.MarkerSeverity.Info
      }
    }
    function Mn(e, t) {
      let i = typeof t.code == 'number' ? String(t.code) : t.code
      return {
        severity: Nn(t.severity),
        startLineNumber: t.range.start.line + 1,
        startColumn: t.range.start.character + 1,
        endLineNumber: t.range.end.line + 1,
        endColumn: t.range.end.character + 1,
        message: t.message,
        code: i,
        source: t.source,
      }
    }
    var X = class {
      constructor(t, i) {
        this._worker = t
        this._triggerCharacters = i
      }
      get triggerCharacters() {
        return this._triggerCharacters
      }
      provideCompletionItems(t, i, r, n) {
        let a = t.uri
        return this._worker(a)
          .then(o => o.doComplete(a.toString(), L(i)))
          .then(o => {
            if (!o) return
            let u = t.getWordUntilPosition(i),
              l = new c.Range(i.lineNumber, u.startColumn, i.lineNumber, u.endColumn),
              h = o.items.map(p => {
                let f = {
                  label: p.label,
                  insertText: p.insertText || p.label,
                  sortText: p.sortText,
                  filterText: p.filterText,
                  documentation: p.documentation,
                  detail: p.detail,
                  command: Un(p.command),
                  range: l,
                  kind: jn(p.kind),
                }
                return (
                  p.textEdit &&
                    (Fn(p.textEdit)
                      ? (f.range = { insert: b(p.textEdit.insert), replace: b(p.textEdit.replace) })
                      : (f.range = b(p.textEdit.range)),
                    (f.insertText = p.textEdit.newText)),
                  p.additionalTextEdits && (f.additionalTextEdits = p.additionalTextEdits.map(j)),
                  p.insertTextFormat === le.Snippet &&
                    (f.insertTextRules = c.languages.CompletionItemInsertTextRule.InsertAsSnippet),
                  f
                )
              })
            return { isIncomplete: o.isIncomplete, suggestions: h }
          })
      }
    }
    function L(e) {
      if (e) return { character: e.column - 1, line: e.lineNumber - 1 }
    }
    function Ie(e) {
      if (e)
        return {
          start: { line: e.startLineNumber - 1, character: e.startColumn - 1 },
          end: { line: e.endLineNumber - 1, character: e.endColumn - 1 },
        }
    }
    function b(e) {
      if (e) return new c.Range(e.start.line + 1, e.start.character + 1, e.end.line + 1, e.end.character + 1)
    }
    function Fn(e) {
      return typeof e.insert < 'u' && typeof e.replace < 'u'
    }
    function jn(e) {
      let t = c.languages.CompletionItemKind
      switch (e) {
        case m.Text:
          return t.Text
        case m.Method:
          return t.Method
        case m.Function:
          return t.Function
        case m.Constructor:
          return t.Constructor
        case m.Field:
          return t.Field
        case m.Variable:
          return t.Variable
        case m.Class:
          return t.Class
        case m.Interface:
          return t.Interface
        case m.Module:
          return t.Module
        case m.Property:
          return t.Property
        case m.Unit:
          return t.Unit
        case m.Value:
          return t.Value
        case m.Enum:
          return t.Enum
        case m.Keyword:
          return t.Keyword
        case m.Snippet:
          return t.Snippet
        case m.Color:
          return t.Color
        case m.File:
          return t.File
        case m.Reference:
          return t.Reference
      }
      return t.Property
    }
    function j(e) {
      if (e) return { range: b(e.range), text: e.newText }
    }
    function Un(e) {
      return e && e.command === 'editor.action.triggerSuggest'
        ? { id: e.command, title: e.title, arguments: e.arguments }
        : void 0
    }
    var Y = class {
      constructor(t) {
        this._worker = t
      }
      provideHover(t, i, r) {
        let n = t.uri
        return this._worker(n)
          .then(a => a.doHover(n.toString(), L(i)))
          .then(a => {
            if (a) return { range: b(a.range), contents: Kn(a.contents) }
          })
      }
    }
    function Vn(e) {
      return e && typeof e == 'object' && typeof e.kind == 'string'
    }
    function cn(e) {
      return typeof e == 'string'
        ? { value: e }
        : Vn(e)
          ? e.kind === 'plaintext'
            ? { value: e.value.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&') }
            : { value: e.value }
          : {
              value:
                '```' +
                e.language +
                `
` +
                e.value +
                '\n```\n',
            }
    }
    function Kn(e) {
      if (e) return Array.isArray(e) ? e.map(cn) : [cn(e)]
    }
    var ke = class {
      constructor(t) {
        this._worker = t
      }
      provideDocumentHighlights(t, i, r) {
        let n = t.uri
        return this._worker(n)
          .then(a => a.findDocumentHighlights(n.toString(), L(i)))
          .then(a => {
            if (a) return a.map(o => ({ range: b(o.range), kind: Hn(o.kind) }))
          })
      }
    }
    function Hn(e) {
      switch (e) {
        case F.Read:
          return c.languages.DocumentHighlightKind.Read
        case F.Write:
          return c.languages.DocumentHighlightKind.Write
        case F.Text:
          return c.languages.DocumentHighlightKind.Text
      }
      return c.languages.DocumentHighlightKind.Text
    }
    var Te = class {
      constructor(t) {
        this._worker = t
      }
      provideDefinition(t, i, r) {
        let n = t.uri
        return this._worker(n)
          .then(a => a.findDefinition(n.toString(), L(i)))
          .then(a => {
            if (a) return [ln(a)]
          })
      }
    }
    function ln(e) {
      return { uri: c.Uri.parse(e.uri), range: b(e.range) }
    }
    var be = class {
        constructor(t) {
          this._worker = t
        }
        provideReferences(t, i, r, n) {
          let a = t.uri
          return this._worker(a)
            .then(o => o.findReferences(a.toString(), L(i)))
            .then(o => {
              if (o) return o.map(ln)
            })
        }
      },
      Ce = class {
        constructor(t) {
          this._worker = t
        }
        provideRenameEdits(t, i, r, n) {
          let a = t.uri
          return this._worker(a)
            .then(o => o.doRename(a.toString(), L(i), r))
            .then(o => Jn(o))
        }
      }
    function Jn(e) {
      if (!e || !e.changes) return
      let t = []
      for (let i in e.changes) {
        let r = c.Uri.parse(i)
        for (let n of e.changes[i])
          t.push({ resource: r, versionId: void 0, textEdit: { range: b(n.range), text: n.newText } })
      }
      return { edits: t }
    }
    var $ = class {
      constructor(t) {
        this._worker = t
      }
      provideDocumentSymbols(t, i) {
        let r = t.uri
        return this._worker(r)
          .then(n => n.findDocumentSymbols(r.toString()))
          .then(n => {
            if (n)
              return n.map(a =>
                Bn(a)
                  ? fn(a)
                  : {
                      name: a.name,
                      detail: '',
                      containerName: a.containerName,
                      kind: dn(a.kind),
                      range: b(a.location.range),
                      selectionRange: b(a.location.range),
                      tags: [],
                    },
              )
          })
      }
    }
    function Bn(e) {
      return 'children' in e
    }
    function fn(e) {
      return {
        name: e.name,
        detail: e.detail ?? '',
        kind: dn(e.kind),
        range: b(e.range),
        selectionRange: b(e.selectionRange),
        tags: e.tags ?? [],
        children: (e.children ?? []).map(t => fn(t)),
      }
    }
    function dn(e) {
      let t = c.languages.SymbolKind
      switch (e) {
        case v.File:
          return t.File
        case v.Module:
          return t.Module
        case v.Namespace:
          return t.Namespace
        case v.Package:
          return t.Package
        case v.Class:
          return t.Class
        case v.Method:
          return t.Method
        case v.Property:
          return t.Property
        case v.Field:
          return t.Field
        case v.Constructor:
          return t.Constructor
        case v.Enum:
          return t.Enum
        case v.Interface:
          return t.Interface
        case v.Function:
          return t.Function
        case v.Variable:
          return t.Variable
        case v.Constant:
          return t.Constant
        case v.String:
          return t.String
        case v.Number:
          return t.Number
        case v.Boolean:
          return t.Boolean
        case v.Array:
          return t.Array
      }
      return t.Function
    }
    var we = class {
        constructor(t) {
          this._worker = t
        }
        provideLinks(t, i) {
          let r = t.uri
          return this._worker(r)
            .then(n => n.findDocumentLinks(r.toString()))
            .then(n => {
              if (n) return { links: n.map(a => ({ range: b(a.range), url: a.target })) }
            })
        }
      },
      G = class {
        constructor(t) {
          this._worker = t
        }
        provideDocumentFormattingEdits(t, i, r) {
          let n = t.uri
          return this._worker(n).then(a =>
            a.format(n.toString(), null, gn(i)).then(o => {
              if (!(!o || o.length === 0)) return o.map(j)
            }),
          )
        }
      },
      Q = class {
        constructor(t) {
          this._worker = t
          this.canFormatMultipleRanges = !1
        }
        provideDocumentRangeFormattingEdits(t, i, r, n) {
          let a = t.uri
          return this._worker(a).then(o =>
            o.format(a.toString(), Ie(i), gn(r)).then(u => {
              if (!(!u || u.length === 0)) return u.map(j)
            }),
          )
        }
      }
    function gn(e) {
      return { tabSize: e.tabSize, insertSpaces: e.insertSpaces }
    }
    var Z = class {
        constructor(t) {
          this._worker = t
        }
        provideDocumentColors(t, i) {
          let r = t.uri
          return this._worker(r)
            .then(n => n.findDocumentColors(r.toString()))
            .then(n => {
              if (n) return n.map(a => ({ color: a.color, range: b(a.range) }))
            })
        }
        provideColorPresentations(t, i, r) {
          let n = t.uri
          return this._worker(n)
            .then(a => a.getColorPresentations(n.toString(), i.color, Ie(i.range)))
            .then(a => {
              if (a)
                return a.map(o => {
                  let u = { label: o.label }
                  return (
                    o.textEdit && (u.textEdit = j(o.textEdit)),
                    o.additionalTextEdits && (u.additionalTextEdits = o.additionalTextEdits.map(j)),
                    u
                  )
                })
            })
        }
      },
      ee = class {
        constructor(t) {
          this._worker = t
        }
        provideFoldingRanges(t, i, r) {
          let n = t.uri
          return this._worker(n)
            .then(a => a.getFoldingRanges(n.toString(), i))
            .then(a => {
              if (a)
                return a.map(o => {
                  let u = { start: o.startLine + 1, end: o.endLine + 1 }
                  return typeof o.kind < 'u' && (u.kind = zn(o.kind)), u
                })
            })
        }
      }
    function zn(e) {
      switch (e) {
        case M.Comment:
          return c.languages.FoldingRangeKind.Comment
        case M.Imports:
          return c.languages.FoldingRangeKind.Imports
        case M.Region:
          return c.languages.FoldingRangeKind.Region
      }
    }
    var ne = class {
      constructor(t) {
        this._worker = t
      }
      provideSelectionRanges(t, i, r) {
        let n = t.uri
        return this._worker(n)
          .then(a => a.getSelectionRanges(n.toString(), i.map(L)))
          .then(a => {
            if (a)
              return a.map(o => {
                let u = []
                for (; o; ) u.push({ range: b(o.range) }), (o = o.parent)
                return u
              })
          })
      }
    }
    function de(e, t) {
      t === void 0 && (t = !1)
      var i = e.length,
        r = 0,
        n = '',
        a = 0,
        o = 16,
        u = 0,
        l = 0,
        h = 0,
        p = 0,
        f = 0
      function C(d, w) {
        for (var E = 0, I = 0; E < d || !w; ) {
          var k = e.charCodeAt(r)
          if (k >= 48 && k <= 57) I = I * 16 + k - 48
          else if (k >= 65 && k <= 70) I = I * 16 + k - 65 + 10
          else if (k >= 97 && k <= 102) I = I * 16 + k - 97 + 10
          else break
          r++, E++
        }
        return E < d && (I = -1), I
      }
      function g(d) {
        ;(r = d), (n = ''), (a = 0), (o = 16), (f = 0)
      }
      function _() {
        var d = r
        if (e.charCodeAt(r) === 48) r++
        else for (r++; r < e.length && U(e.charCodeAt(r)); ) r++
        if (r < e.length && e.charCodeAt(r) === 46)
          if ((r++, r < e.length && U(e.charCodeAt(r)))) for (r++; r < e.length && U(e.charCodeAt(r)); ) r++
          else return (f = 3), e.substring(d, r)
        var w = r
        if (r < e.length && (e.charCodeAt(r) === 69 || e.charCodeAt(r) === 101))
          if (
            (r++,
            ((r < e.length && e.charCodeAt(r) === 43) || e.charCodeAt(r) === 45) && r++,
            r < e.length && U(e.charCodeAt(r)))
          ) {
            for (r++; r < e.length && U(e.charCodeAt(r)); ) r++
            w = r
          } else f = 3
        return e.substring(d, w)
      }
      function R() {
        for (var d = '', w = r; ; ) {
          if (r >= i) {
            ;(d += e.substring(w, r)), (f = 2)
            break
          }
          var E = e.charCodeAt(r)
          if (E === 34) {
            ;(d += e.substring(w, r)), r++
            break
          }
          if (E === 92) {
            if (((d += e.substring(w, r)), r++, r >= i)) {
              f = 2
              break
            }
            var I = e.charCodeAt(r++)
            switch (I) {
              case 34:
                d += '"'
                break
              case 92:
                d += '\\'
                break
              case 47:
                d += '/'
                break
              case 98:
                d += '\b'
                break
              case 102:
                d += '\f'
                break
              case 110:
                d += `
`
                break
              case 114:
                d += '\r'
                break
              case 116:
                d += '	'
                break
              case 117:
                var k = C(4, !0)
                k >= 0 ? (d += String.fromCharCode(k)) : (f = 4)
                break
              default:
                f = 5
            }
            w = r
            continue
          }
          if (E >= 0 && E <= 31)
            if (re(E)) {
              ;(d += e.substring(w, r)), (f = 2)
              break
            } else f = 6
          r++
        }
        return d
      }
      function V() {
        if (((n = ''), (f = 0), (a = r), (l = u), (p = h), r >= i)) return (a = i), (o = 17)
        var d = e.charCodeAt(r)
        if (xe(d)) {
          do r++, (n += String.fromCharCode(d)), (d = e.charCodeAt(r))
          while (xe(d))
          return (o = 15)
        }
        if (re(d))
          return (
            r++,
            (n += String.fromCharCode(d)),
            d === 13 &&
              e.charCodeAt(r) === 10 &&
              (r++,
              (n += `
`)),
            u++,
            (h = r),
            (o = 14)
          )
        switch (d) {
          case 123:
            return r++, (o = 1)
          case 125:
            return r++, (o = 2)
          case 91:
            return r++, (o = 3)
          case 93:
            return r++, (o = 4)
          case 58:
            return r++, (o = 6)
          case 44:
            return r++, (o = 5)
          case 34:
            return r++, (n = R()), (o = 10)
          case 47:
            var w = r - 1
            if (e.charCodeAt(r + 1) === 47) {
              for (r += 2; r < i && !re(e.charCodeAt(r)); ) r++
              return (n = e.substring(w, r)), (o = 12)
            }
            if (e.charCodeAt(r + 1) === 42) {
              r += 2
              for (var E = i - 1, I = !1; r < E; ) {
                var k = e.charCodeAt(r)
                if (k === 42 && e.charCodeAt(r + 1) === 47) {
                  ;(r += 2), (I = !0)
                  break
                }
                r++, re(k) && (k === 13 && e.charCodeAt(r) === 10 && r++, u++, (h = r))
              }
              return I || (r++, (f = 1)), (n = e.substring(w, r)), (o = 13)
            }
            return (n += String.fromCharCode(d)), r++, (o = 16)
          case 45:
            if (((n += String.fromCharCode(d)), r++, r === i || !U(e.charCodeAt(r)))) return (o = 16)
          case 48:
          case 49:
          case 50:
          case 51:
          case 52:
          case 53:
          case 54:
          case 55:
          case 56:
          case 57:
            return (n += _()), (o = 11)
          default:
            for (; r < i && bn(d); ) r++, (d = e.charCodeAt(r))
            if (a !== r) {
              switch (((n = e.substring(a, r)), n)) {
                case 'true':
                  return (o = 8)
                case 'false':
                  return (o = 9)
                case 'null':
                  return (o = 7)
              }
              return (o = 16)
            }
            return (n += String.fromCharCode(d)), r++, (o = 16)
        }
      }
      function bn(d) {
        if (xe(d) || re(d)) return !1
        switch (d) {
          case 125:
          case 93:
          case 123:
          case 91:
          case 34:
          case 58:
          case 44:
          case 47:
            return !1
        }
        return !0
      }
      function Cn() {
        var d
        do d = V()
        while (d >= 12 && d <= 15)
        return d
      }
      return {
        setPosition: g,
        getPosition: function () {
          return r
        },
        scan: t ? Cn : V,
        getToken: function () {
          return o
        },
        getTokenValue: function () {
          return n
        },
        getTokenOffset: function () {
          return a
        },
        getTokenLength: function () {
          return r - a
        },
        getTokenStartLine: function () {
          return l
        },
        getTokenStartCharacter: function () {
          return a - p
        },
        getTokenError: function () {
          return f
        },
      }
    }
    function xe(e) {
      return (
        e === 32 ||
        e === 9 ||
        e === 11 ||
        e === 12 ||
        e === 160 ||
        e === 5760 ||
        (e >= 8192 && e <= 8203) ||
        e === 8239 ||
        e === 8287 ||
        e === 12288 ||
        e === 65279
      )
    }
    function re(e) {
      return e === 10 || e === 13 || e === 8232 || e === 8233
    }
    function U(e) {
      return e >= 48 && e <= 57
    }
    var pn
    ;(function (e) {
      e.DEFAULT = { allowTrailingComma: !1 }
    })(pn || (pn = {}))
    var hn = de
    function yn(e) {
      return { getInitialState: () => new ge(null, null, !1, null), tokenize: (t, i) => fr(e, t, i) }
    }
    var mn = 'delimiter.bracket.json',
      vn = 'delimiter.array.json',
      rr = 'delimiter.colon.json',
      tr = 'delimiter.comma.json',
      ir = 'keyword.json',
      ar = 'keyword.json',
      or = 'string.value.json',
      sr = 'number.json',
      ur = 'string.key.json',
      cr = 'comment.block.json',
      lr = 'comment.line.json'
    var W = class e {
        constructor(t, i) {
          this.parent = t
          this.type = i
        }
        static pop(t) {
          return t ? t.parent : null
        }
        static push(t, i) {
          return new e(t, i)
        }
        static equals(t, i) {
          if (!t && !i) return !0
          if (!t || !i) return !1
          for (; t && i; ) {
            if (t === i) return !0
            if (t.type !== i.type) return !1
            ;(t = t.parent), (i = i.parent)
          }
          return !0
        }
      },
      ge = class e {
        constructor(t, i, r, n) {
          ;(this._state = t), (this.scanError = i), (this.lastWasColon = r), (this.parents = n)
        }
        clone() {
          return new e(this._state, this.scanError, this.lastWasColon, this.parents)
        }
        equals(t) {
          return t === this
            ? !0
            : !t || !(t instanceof e)
              ? !1
              : this.scanError === t.scanError &&
                this.lastWasColon === t.lastWasColon &&
                W.equals(this.parents, t.parents)
        }
        getStateData() {
          return this._state
        }
        setStateData(t) {
          this._state = t
        }
      }
    function fr(e, t, i, r = 0) {
      let n = 0,
        a = !1
      switch (i.scanError) {
        case 2:
          ;(t = '"' + t), (n = 1)
          break
        case 1:
          ;(t = '/*' + t), (n = 2)
          break
      }
      let o = hn(t),
        u = i.lastWasColon,
        l = i.parents,
        h = { tokens: [], endState: i.clone() }
      for (;;) {
        let p = r + o.getPosition(),
          f = '',
          C = o.scan()
        if (C === 17) break
        if (p === r + o.getPosition())
          throw new Error('Scanner did not advance, next 3 characters are: ' + t.substr(o.getPosition(), 3))
        switch ((a && (p -= n), (a = n > 0), C)) {
          case 1:
            ;(l = W.push(l, 0)), (f = mn), (u = !1)
            break
          case 2:
            ;(l = W.pop(l)), (f = mn), (u = !1)
            break
          case 3:
            ;(l = W.push(l, 1)), (f = vn), (u = !1)
            break
          case 4:
            ;(l = W.pop(l)), (f = vn), (u = !1)
            break
          case 6:
            ;(f = rr), (u = !0)
            break
          case 5:
            ;(f = tr), (u = !1)
            break
          case 8:
          case 9:
            ;(f = ir), (u = !1)
            break
          case 7:
            ;(f = ar), (u = !1)
            break
          case 10:
            let _ = (l ? l.type : 0) === 1
            ;(f = u || _ ? or : ur), (u = !1)
            break
          case 11:
            ;(f = sr), (u = !1)
            break
        }
        if (e)
          switch (C) {
            case 12:
              f = lr
              break
            case 13:
              f = cr
              break
          }
        ;(h.endState = new ge(i.getStateData(), o.getTokenError(), u, l)), h.tokens.push({ startIndex: p, scopes: f })
      }
      return h
    }
    var x
    function dr() {
      return new Promise((e, t) => {
        if (!x) return t('JSON not registered!')
        e(x)
      })
    }
    var Ee = class extends q {
      constructor(t, i, r) {
        super(t, i, r.onDidChange),
          this._disposables.push(
            c.editor.onWillDisposeModel(n => {
              this._resetSchema(n.uri)
            }),
          ),
          this._disposables.push(
            c.editor.onDidChangeModelLanguage(n => {
              this._resetSchema(n.model.uri)
            }),
          )
      }
      _resetSchema(t) {
        this._worker().then(i => {
          i.resetSchema(t.toString())
        })
      }
    }
    function gr(e) {
      let t = [],
        i = [],
        r = new D(e)
      t.push(r), (x = (...o) => r.getLanguageServiceWorker(...o))
      function n() {
        let { languageId: o, modeConfiguration: u } = e
        Tn(i),
          u.documentFormattingEdits && i.push(c.languages.registerDocumentFormattingEditProvider(o, new G(x))),
          u.documentRangeFormattingEdits &&
            i.push(c.languages.registerDocumentRangeFormattingEditProvider(o, new Q(x))),
          u.completionItems && i.push(c.languages.registerCompletionItemProvider(o, new X(x, [' ', ':', '"']))),
          u.hovers && i.push(c.languages.registerHoverProvider(o, new Y(x))),
          u.documentSymbols && i.push(c.languages.registerDocumentSymbolProvider(o, new $(x))),
          u.tokens && i.push(c.languages.setTokensProvider(o, yn(!0))),
          u.colors && i.push(c.languages.registerColorProvider(o, new Z(x))),
          u.foldingRanges && i.push(c.languages.registerFoldingRangeProvider(o, new ee(x))),
          u.diagnostics && i.push(new Ee(o, x, e)),
          u.selectionRanges && i.push(c.languages.registerSelectionRangeProvider(o, new ne(x)))
      }
      n(), t.push(c.languages.setLanguageConfiguration(e.languageId, pr))
      let a = e.modeConfiguration
      return (
        e.onDidChange(o => {
          o.modeConfiguration !== a && ((a = o.modeConfiguration), n())
        }),
        t.push(kn(i)),
        kn(t)
      )
    }
    function kn(e) {
      return { dispose: () => Tn(e) }
    }
    function Tn(e) {
      for (; e.length; ) e.pop().dispose()
    }
    var pr = {
      wordPattern: /(-?\d*\.\d\w*)|([^\[\{\]\}\:\"\,\s]+)/g,
      comments: { lineComment: '//', blockComment: ['/*', '*/'] },
      brackets: [
        ['{', '}'],
        ['[', ']'],
      ],
      autoClosingPairs: [
        { open: '{', close: '}', notIn: ['string'] },
        { open: '[', close: ']', notIn: ['string'] },
        { open: '"', close: '"', notIn: ['string'] },
      ],
    }
    return Ln(hr)
  })()
  return moduleExports
})
