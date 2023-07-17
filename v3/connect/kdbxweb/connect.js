/* global kdbxweb */
/* global tldjs */

class KWFILE {
  open(name = 'database') {
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(name, 1);
      request.onerror = reject;
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = () => {
        request.result.createObjectStore('files', {
          autoIncrement: true
        });
      };
    });
  }
  read() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('files', 'readonly');
      const files = [];
      transaction.objectStore('files').openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
          files.push(cursor.value);
          cursor.continue();
        }
      };
      transaction.onerror = e => reject(Error('read, ' + e.target.error));
      transaction.oncomplete = () => resolve(files);
    });
  }
  write(bytes) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('files', 'readwrite');
      transaction.oncomplete = resolve;
      transaction.onerror = e => reject(Error('write, ' + e.target.error));
      transaction.objectStore('files').add(bytes);
    });
  }
  clear() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('files', 'readwrite');
      const req = transaction.objectStore('files').clear();
      req.onsuccess = resolve;
      req.onerror = e => {
        reject(Error('read, ' + e.target.error));
      };
    });
  }
}
class KWPASS {
  prepare() {
    this.file = new KWFILE();
    return this.file.open();
  }
  search({url, submiturl}) {
    const {hostname} = new URL(url || submiturl);

    const domain = tldjs.getDomain(url);
    const matches = [];
    const step = group => {
      for (const g of (group.groups || [])) {
        step(g);
      }
      for (const entry of group.entries) {
        const entryUrl = entry.fields.URL;
        if (entryUrl && (
          entryUrl.indexOf('://' + hostname) !== -1 ||
          entryUrl.indexOf('://' + domain) !== -1 ||
          entryUrl.indexOf(hostname) === 0 ||
          entryUrl.indexOf(domain) === 0)) {
          matches.push(entry);
        }
      }
    };
    for (const group of this.db.groups) {
      step(group);
    }

    return Promise.resolve({
      Entries: matches.map(e => ({
        Login: e.fields.UserName,
        Name: e.fields.Title,
        Password: e.fields.Password ? e.fields.Password.getText() : '',
        StringFields: Object.entries(e.fields).map(([key, value]) => ({
          Key: key.replace(/^KPH:\s*/, ''),
          Value: typeof value === 'object' ? value.getText() : value
        }))
      }))
    });
  }
  async set(query) {
    const {url, submiturl, login, password} = query;
    try {
      const group = this.db.getDefaultGroup();
      const entry = this.db.createEntry(group);
      entry.pushHistory();
      entry.fields.UserName = login;
      entry.fields.URL = url || submiturl;
      entry.fields.Password = kdbxweb.ProtectedValue.fromString(password || '');
      entry.times.update();
      // downgrade to KDBX3
      this.db.setVersion(3);
      const ab = await this.db.save();
      return this.attach(new Uint8Array(ab));
    }
    catch (e) {
      throw Error('Is database unlocked? ' + e.message);
    }
  }
  async open(password) {
    password = kdbxweb.ProtectedValue.fromString(password);

    const files = await this.file.read();

    if (files.length < 1) {
      throw Error('No database. Use options page to add a database');
    }
    const credentials = new kdbxweb.Credentials(password, files[1]);
    return kdbxweb.Kdbx.load(files[0].buffer, credentials).then(db => {
      this.db = db;
    }).catch(e => {
      console.warn(e);
      throw Error('Cannot open database; ' + e.message);
    });
  }
  async attach(fileBytes, keyBytes) {
    await this.dettach();
    await this.file.write(fileBytes);
    if (keyBytes) {
      await this.file.write(keyBytes);
    }
  }
  dettach() {
    return this.file.clear();
  }
  export() {
    // downgrade to KDBX3
    this.db.setVersion(3);
    this.db.save().then(ab => {
      const blob = new Blob([new Uint8Array(ab)], {
        type: 'octet/stream'
      });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = 'keepass.db';
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(href);
      }, 1000);
    });
  }
}
