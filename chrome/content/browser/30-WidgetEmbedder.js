var EXPORT = ["WidgetEmbedder", "IconEmbedder"];

var getEntryURL = entryURL;
var getAddPageURL = addPageURL;

function WidgetEmbedder(doc) {
    this.site = SiteInfoSet.Article.get(doc);
    if (!this.site || this.site.data.disable) return;
    this.doc = null;
    let pref = Prefs.bookmark;
    this._inNewTab = pref.get("link.openInNewTab");
    this._embedCounter = pref.get("embed.counter");
    this._embedComments = pref.get("embed.comments");
    this._embedAddButton = pref.get("embed.addButton");
    this._timerId = doc.defaultView.setTimeout(this.onTimer, WidgetEmbedder.INITIAL_DELAY, this, doc);
    this.embedStyle();
    doc.addEventListener("HB.PageInserted", this, false, true);
}

const embedStrings =
    new Strings("chrome://hatenabookmark/locale/embed.properties");


extend(WidgetEmbedder, {
    INITIAL_DELAY:  50,
    MUTATION_DELAY: 350,

    IMAGE_API_PREFIX:   'http://b.st-hatena.com/entry/image/',
    //COMMENTS_IMAGE_URL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAANCAYAAACZ3F9%2FAAAAAXNSR0IArs4c6QAAAAZiS0dEAP8A%2FwD%2FoL2nkwAAAblJREFUKM%2BN0LFuE0EUBdD3Zt6MHTMOQcigFXEcLISEoKBwifAfIFk04SOgoaRJwxf4ByiRGwrXFAjEJ6SBAtkyVtYSsZ1Z7%2B7M2xmaOGXkW98jXV0cj8cNY0wDAIzW%2BiDGaBCxgYgaACDG6GKMG0S0zrklAFhr7YaMMY0Y412lVCKlbGut7xHRbSHELQCAEELGzCvnXEpEU%2B%2F93BgDBABGKZV8%2Fp2czi5VH27Ig6b%2FdvJofsrMJWmtD6SU7dml6n95e3STg8Fw0ldKtYUQSwEAe0R0B3bMVXdPxBilEELtCoUQKsYoBSJWIQS%2FKwwheESsBADkzHyxK7zq5uScWxLRtL3PPwbDyYttYXvUYDi5RodN%2F917P2XmJQGA9d7P3zw%2B%2F1ir1Z7U6%2FXjD1%2FNuy16dj%2F8OnmajYui%2BOOcOysKP0dES9bajTEGyrLEEEJZVdXssFl7PhhOXh7t%2B5%2BvHv77tFr5C2ZOQwh%2FEXFprd1Qnudlt9vlNE25qqpsvV6fvz7O3iul6ohYeQ85M2dSyizLMtvpdIrFYlHhdv9oNJKtVksBAAEA5XmutNYhxshFUfgkSXyv17t%2B%2Fz%2BH2uPiS1VqNgAAAABJRU5ErkJggg%3D%3D',
    COMMENTS_IMAGE_URL: B_STATIC_HTTP + 'images/b-comment-balloon.png',
    //ADD_BUTTON_URL:     'data:image/gif;base64,R0lGODlhEAAMAJECAP%2F%2F%2FxhBzv%2F%2F%2FwAAACH5BAEAAAIALAAAAAAQAAwAAAIjVI6ZBu3%2FTlNOAovD1JfnDXZJ%2BIGl1UFlelLpC8WXodSHUAAAOw%3D%3D',
    ADD_BUTTON_URL:     B_STATIC_HTTP + 'images/append.gif',

    STRING_SHOW_ENTRY_TITLE:   embedStrings.get('showEntryTitle'),
    STRING_SHOW_ENTRY_TEXT:    embedStrings.get('showEntryText'),
    STRING_SHOW_COMMENT_TITLE: embedStrings.get('showCommentTitle'),
    STRING_SHOW_COMMENT_TEXT:  embedStrings.get('showCommentText'),
    STRING_ADD_BOOKMARK_TITLE: embedStrings.get('addBookmarkTitle'),
    STRING_ADD_BOOKMARK_TEXT:  embedStrings.get('addBookmarkText'),
});
(function () {
    var utils = {};
    Components.utils.import("resource://hatenabookmark/modules/00-utils.jsm", utils);
    WidgetEmbedder.STYLE = utils.loadCssStrFromResource("widget-embedder.css");
}).call(this);

extend(WidgetEmbedder.prototype, {
    embedStyle: function WE_embedStyle() {
        let doc = this.site.doc;
        let style = doc.createElementNS(XHTML_NS, "style");
        style.setAttribute("type", "text/css");
        style.textContent = WidgetEmbedder.STYLE + (this.site.data.style || "");
        let head = doc.getElementsByTagName("head").item(0);
        if (!head) return;
        head.appendChild(style);
    },

    embed: function WE_embed() {
        //p('WidgetEmbedder#embed on ' + this.site.url);
        this.doc = this.site.doc;
        this.site.queryAll("paragraph", this.doc)
                 .forEach(this.embedInParagraph, this);
        this.doc = null;
    },

    embedInParagraph: function WE_embedInParagraph(paragraph) {
        if (paragraph.hasAttributeNS(HB_NS, "annotation")) return;
        paragraph.setAttributeNS(HB_NS, "hb:annotation", "true");

        let link = this.site.query("link", paragraph) || paragraph;
        if (!link.href || !/^https?:\/\//.test(link.href)) return;
        let existing = this.getExistingWidgets(paragraph, link);
        let points = this.getInsertionPoints(paragraph, link, existing);
        let anchorElems = this.createWidgetAnchorElems(link);
        let space = this.doc.createTextNode(" ");
        let fragment = this.doc.createDocumentFragment();
        fragment.appendChild(space.cloneNode(false));

        const DISPLAY_NONE = "display: none !important;";
        let counterImage = existing.counterImage;
        let standbys = [];
        if (points.addButton) {
            let f = fragment.cloneNode(true);
            f.appendChild(anchorElems.addButton);
            f.appendChild(space.cloneNode(false));
            points.addButton.insertNode(f);
        }
        if (points.comments) {
            let comments = anchorElems.comments;
            // カウンタをこれから埋め込むか、読み込み途中の
            // カウンタ画像があるか、幅 1 ピクセルのカウンタ画像があるなら、
            // コメント表示ボタン (吹き出しアイコン) を表示しない。
            if (points.counter || (counterImage &&
                (!counterImage.complete || counterImage.naturalWidth === 1))) {
                comments.setAttribute("style", DISPLAY_NONE);
            }
            // TODO 名前空間を使うよりもカスタムデータ属性を使うようにしたい
            comments.setAttributeNS(HB_NS, "hb:url", link.href);
            standbys.push(comments);
            let f = fragment.cloneNode(true);
            f.appendChild(comments);
            if (points.comments !== points.addButton)
                f.appendChild(space.cloneNode(false));
            points.comments.insertNode(f);
        }
        if (points.counter) {
            let counter = anchorElems.counter;
            counter.setAttribute("style", DISPLAY_NONE);
            counterImage = counter.firstChild;
            standbys.push(counter);
            let f = fragment.cloneNode(true);
            f.appendChild(counter);
            if (points.counter !== points.comments)
                f.appendChild(space.cloneNode(false));
            points.counter.insertNode(f);
        }

        if (standbys.length && counterImage && !counterImage.complete) {
            counterImage.addEventListener("load", onCounterEvent, false);
            counterImage.addEventListener("error", onCounterEvent, false);
            counterImage.addEventListener("abort", onCounterEvent, false);
        }
        // XXX これは必要か? Firefox 本体からはこのような
        // 明示的に変数に null を指定するコードは削除されつつある
        paragraph = link = existing = points = counterImage = space = fragment = null;

        function onCounterEvent(event) {
            let target = event.target;
            if (event.type === "load" && target.naturalWidth !== 1) {
                standbys.forEach(function (a) a.removeAttribute("style"));
                target.style.cssText =
                    'width: ' + target.naturalWidth + 'px !important;' +
                    'height: ' + target.naturalHeight + 'px !important;';
            }
            target.removeEventListener("load", onCounterEvent, false);
            target.removeEventListener("error", onCounterEvent, false);
            target.removeEventListener("abort", onCounterEvent, false);
        }
    },

    getInsertionPoints: function WE_getInsertionPoints(paragraph, link,
                                                       existing) {
        let counterPoint = null, commentsPoint = null, addButtonPoint = null;
        if (!existing.counter) {
            let anchor = existing.entry ||
                         existing.comments ||
                         existing.addButton;
            if (anchor) {
                counterPoint = this.doc.createRange();
                counterPoint.selectNode(anchor);
                counterPoint.collapse(anchor !== existing.entry);
            } else {
                counterPoint = this.getAnnotationPoint(paragraph, link);
            }
        }
        if (!existing.comments) {
            if (existing.counter) {
                commentsPoint = this.doc.createRange();
                commentsPoint.selectNode(existing.counter);
                commentsPoint.collapse(false);
            } else {
                commentsPoint = counterPoint;
            }
        }
        if (!existing.addButton) {
            if (existing.comments) {
                addButtonPoint = this.doc.createRange();
                addButtonPoint.selectNode(existing.comments);
                addButtonPoint.collapse(false);
            } else {
                addButtonPoint = commentsPoint;
            }
        }
        return {
            counter:   this._embedCounter   ? counterPoint   : null,
            comments:  this._embedComments  ? commentsPoint  : null,
            addButton: this._embedAddButton ? addButtonPoint : null,
        };
    },

    getExistingWidgets: function WE_getExistingWidgets(paragraph, link) {
        const url = iri2uri(link.href);
        const sharpEscapedURL = url.replace(/#/g, '%23');
        const entryURL    = getEntryURL(link.href);
        const oldEntryURL = B_HTTP + 'entry/' + sharpEscapedURL;
        const imageAPIPrefix    = 'http://b.st-hatena.com/entry/image/';
        const oldImageAPIPrefix = B_HTTP + 'entry/image/';
        const addURL     = getAddPageURL(link.href);
        const oldAddURL  = B_HTTP + 'my/add.confirm?url=' + escapeIRI(url);
        const oldAddURL2 = B_HTTP + 'append?' + sharpEscapedURL;
        const entryImagePrefix = 'http://d.hatena.ne.jp/images/b_entry';
        let widgets = {
            entry:        null,
            counter:      null,
            counterImage: null,
            comments:     null,
            addButton:    null,
        };
        Array.forEach(paragraph.getElementsByTagName('a'), function (a) {
            switch (a.href) {
            case entryURL:
            case oldEntryURL:
                let content = a.firstChild;
                if (!content) break;
                if (content.nodeType === Node.TEXT_NODE) {
                    if (content.nodeValue.indexOf(' user') !== -1) {
                        let parentName = a.parentNode.nodeName.toLowerCase();
                        widgets.counter =
                            (parentName === 'em' || parentName === 'strong')
                            ? a.parentNode : a;
                        break;
                    }
                    if (!content.nextSibling) break;
                    content = content.nextSibling;
                }
                if (content instanceof Ci.nsIDOMHTMLImageElement) {
                    let src = content.src;
                    if (src.indexOf(imageAPIPrefix) === 0 ||
                        src.indexOf(oldImageAPIPrefix) === 0) {
                        widgets.counter = a;
                        widgets.counterImage = content;
                    } else if (src.indexOf(entryImagePrefix) === 0) {
                        widgets.entry = a;
                    }
                }
                break;

            case addURL:
            case oldAddURL:
            case oldAddURL2:
                widgets.addButton = a;
                break;
            }
        });
        widgets.comments = paragraph.getElementsByClassName("hatena-bcomment-view-icon").item(0);
        return widgets;
    },

    getAnnotationPoint: function WE_getAnnotationPoint(paragraph, link) {
        let annotation = this.site.query("annotation", paragraph) || link;
        if (annotation instanceof Ci.nsIDOMRange) return annotation;
        let tagName = annotation instanceof Ci.nsIDOMHTMLElement ? annotation.tagName.toUpperCase() : '';
        let tagNames = [
            'BR', 'HR', 'A', 'IMG',
            'CANVAS', 'OBJECT',
            'INPUT', 'BUTTON',
            'SELECT', 'TEXTAREA',
        ];
        let point = this.doc.createRange();
        let position = this.site.data.annotationPosition || (tagNames.indexOf(tagName) > -1 ? 'after' : 'last');
        if (position === 'before' || position === 'after')
            point.selectNode(annotation);
        else
            point.selectNodeContents(annotation);
        point.collapse(position === 'before' || position === 'start');
        return point;
    },

    createWidgetAnchorElems: function WE_createWidgetAnchorElems(link) {
        const WE = WidgetEmbedder;
        let url = link.href;
        let entryURL = getEntryURL(url);
        let doc = this.doc;

        function createAnchorElem( info ) {
            // info がとるプロパティ : classNames, uriStr, title, imgUriStr, imgAltStr, [imgSize]

            var ancElem = doc.createElementNS(XHTML_NS, "a");
            info.classNames.forEach(function (name) {
                ancElem.classList.add(name);
            });
            ancElem.setAttribute("href", info.uriStr);
            ancElem.setAttribute("title", info.title);
            var imgElem = doc.createElementNS(XHTML_NS, "img");
            imgElem.setAttribute("src", info.imgUriStr);
            imgElem.setAttribute("alt", info.imgAltStr);
            if (info.imgSize) {
                let imgSize = info.imgSize;
                ["width", "height"].forEach(function (name) {
                    if (imgSize[name]) imgElem.setAttribute(name, imgSize[name]);
                });
            }
            ancElem.appendChild(imgElem);
            return ancElem;
        }

        var ancElems = {
            counter: createAnchorElem({
                classNames: [ "hBookmark-widget", "hBookmark-widget-counter" ],
                uriStr: entryURL,
                title: WE.STRING_SHOW_ENTRY_TITLE,
                imgUriStr: WE.IMAGE_API_PREFIX + url.replace(/#/g, "%23"),
                imgAltStr: WE.STRING_SHOW_ENTRY_TEXT
            }),
            comments: createAnchorElem({
                classNames: [ "hBookmark-widget", "hBookmark-widget-comments" ],
                uriStr: entryURL,
                title: WE.STRING_SHOW_COMMENT_TITLE,
                imgUriStr: WE.COMMENTS_IMAGE_URL,
                imgAltStr: WE.STRING_SHOW_COMMENT_TEXT,
                imgSize: { width: "14", height: "13" }
            }),
            addButton: createAnchorElem({
                classNames: [ "hBookmark-widget", "hBookmark-widget-add-button" ],
                uriStr: addPageURL(url),
                title: WE.STRING_ADD_BOOKMARK_TITLE,
                imgUriStr: WE.ADD_BUTTON_URL,
                imgAltStr: WE.STRING_ADD_BOOKMARK_TEXT,
                imgSize: { width: "16", height: "12" }
            })
        };
        if (this._inNewTab) {
            for (var name in ancElems) {
                ancElems[name].setAttribute("target", "_blank");
            }
        }
        return ancElems;
    },

    handleEvent: function WE_handleEvent(event) {
        let doc = event.currentTarget;
        switch (event.type) {
        case "DOMNodeInserted":
            if (this._timerId) break;
            this._timerId = doc.defaultView.setTimeout(this.onTimer, WidgetEmbedder.MUTATION_DELAY, this, doc);
            doc.removeEventListener("DOMNodeInserted", this, false);
            break;

        case "HB.PageInserted":
            doc.removeEventListener("DOMNodeInserted", this, false);
            this.embed();
            break;
        }
    },

    onTimer: function WE_onTimer(self, doc) {
        self.embed();
        self._timerId = 0;
        doc.addEventListener("DOMNodeInserted", self, false);
    },
});


function tryToEmbedWidgets(event) {
    let doc = event.target;
    if (Prefs.bookmark.get("embed.enabled") &&
        doc instanceof HTMLDocument &&
        /^https?:/.test(doc.defaultView.location.href) &&
        HTTPCache.counter.isValid(doc.defaultView.location.href))
        new WidgetEmbedder(doc);
}

window.addEventListener("load", function WidgetEmbedder_BEGIN() {
    gBrowser.addEventListener("DOMContentLoaded", tryToEmbedWidgets, true);
}, false);


// "IconEmbedder" is deprecated.  Use "WidgetEmbedder".
var IconEmbedder = WidgetEmbedder;
