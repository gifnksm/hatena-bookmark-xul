
// Sync to remote bookmark

const EXPORT = ["Sync"];

var Sync;
// Sync オブジェクトは一つだけ

if (shared.has('Sync')) {
    Sync = shared.get('Sync');
} else {

Sync = {};
EventService.implement(Sync);
extend(Sync, {
    init: function Sync_init () {
        let db = model('Bookmark').db;
        if (!db.tableExists('bookmarks')) {
            hBookmark.Model.resetAll();
        }
        this.sync();
    },
    createDataStructure: function Sync_createDataStructure (text) {
        let infos = text.split("\n");
        let bookmarks = infos.splice(0, infos.length * 3/4);
        return [bookmarks, infos];
    },
    _syncing: false,
    sync: function Sync_sync () {
        if (this._syncing) return;
        this._syncing = true;

        try {
             let url = User.user.dataURL;
             let b = model('Bookmark').findFirst({order: 'date desc'});

             this.dispatch('start');
             if (b && b.date) {
                 net.get(url, method(this, 'fetchCallback'), method(this, 'errorback'), true, {
                     timestamp: b.date,
                     _now: ((new Date())*1), // cache のため
                 });
             } else {
                 net.get(url, method(this, 'fetchCallback'), method(this, 'errorback'), true);
             }
        } catch(er) {
            this.errorback();
        }
    },
    get nowSyncing() this._syncing,
    errorback: function Sync_errorAll () {
        this._syncing = false;
        this.dispatch('fail');
    },
    get db() {
        return User.user.database;
    },
    fetchCallback: function Sync_allCallback (req)  {
    try {
        this.dispatch('progress', {value: 0});
        if (!User.user) {
            // XXX: データロード後にユーザが無い
            this.errorback();
            return;
        }

        let BOOKMARK = model('Bookmark');

        let text = req.responseText;
        if (!text.length) {
            this.dispatch('complete');
            return;
        }

        let items = Application.prefs.get("extensions.hatenabookmark.sync.oneTimeItmes").value || 200;
        let waitTime = Application.prefs.get("extensions.hatenabookmark.sync.syncWait").value || 1000;

        let commentRe = new RegExp('\\s+$','');
        let [bookmarks, infos] = this.createDataStructure(text);
        p(sprintf('start: %d data', infos.length));
        let now = Date.now();
        p('start');
        this.db.beginTransaction();
        let len = infos.length;
        for (let i = len - 1;  i >= 0; i--) {
            let bi = i * 3;
            let timestamp = infos[i].split("\t", 2)[1];
            let title = bookmarks[bi];
            let comment = bookmarks[bi+1];
            let url = bookmarks[bi+2];
            let b = new BOOKMARK;
            b.title = title;
            b.comment = comment.replace(commentRe, '');
            b.url = url;
            b.date = parseInt(timestamp);
            if (url) {
                try {
                    b.save();
                } catch(e) {
                    p('error: ' + [url, title, comment, timestamp].toString());
                }
            } else {
            }
            if (i % items == 0) {
                this.dispatch('progress', { value: (len-i)/len*100|0 });
                this.db.commitTransaction();
                if (i % (items * 10) == 0) {
                    // 大量に件数があるときに、しょっちゅう BookmarksUpdated を発行すると重くなるため
                    EventService.dispatch("BookmarksUpdated");
                }
                async.wait(waitTime);
                this.db.beginTransaction();
                p('wait: ' + (Date.now() - now));
            }
        }
        BOOKMARK.db.commitTransaction();
        this.dispatch('complete');
        EventService.dispatch("BookmarksUpdated");

        p(infos.length);
        p('time: ' + (Date.now() - now));
    } catch(er) {
        this.errorback();
    }
    }
});

Sync.completeListener = Sync.createListener('complete', function() {
    Sync._syncing = false;
});

EventService.createListener('UserChange', function() {
    if (User.user)
        Sync.init();
}, User);

Sync.SyncTimer = new Timer(1000 * 60 * 30); // 30分に一度 Sync
Sync.SyncTimer.createListener('timer', function() {
    if (User.user)
        Sync.init();
});
Sync.SyncTimer.start();


shared.set('Sync', Sync);
}

// EventService.createListener('firstPreload', function() {
//     if (User.user) {
//         async.wait(10); // XXX: waiting...
//         Sync.init();
//     }
// }, window);

