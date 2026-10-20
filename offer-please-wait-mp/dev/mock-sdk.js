/**
 * 内存版 wx-server-sdk，只实现后端实际用到的那部分 API。
 * 目的：在没有云环境的情况下，把云函数按真实调用路径跑一遍。
 *
 * 支持：collection.add / doc().get|update|remove / where().orderBy().limit().get|count|update
 *      command.gt|gte|lt|lte|in|inc
 *      唯一索引（模拟 votes、quota_ledger 上的约束）
 *      openapi.security.msgSecCheck（按关键词返回 pass/risky/review）
 */

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function cmd(name, v) {
  return { $cmd: name, v: v };
}

function match(doc, where) {
  const keys = Object.keys(where || {});
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const cond = where[k];
    const val = doc[k];

    if (cond && cond.$cmd) {
      switch (cond.$cmd) {
        case 'gt':
          if (!(val > cond.v)) return false;
          break;
        case 'gte':
          if (!(val >= cond.v)) return false;
          break;
        case 'lt':
          if (!(val < cond.v)) return false;
          break;
        case 'lte':
          if (!(val <= cond.v)) return false;
          break;
        case 'in':
          if (cond.v.indexOf(val) < 0) return false;
          break;
        default:
          return false;
      }
    } else if (val !== cond) {
      return false;
    }
  }
  return true;
}

function setPath(doc, path, value) {
  const parts = path.split('.');
  let cur = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function getPath(doc, path) {
  return path.split('.').reduce((o, k) => (o === undefined || o === null ? o : o[k]), doc);
}

function applyUpdate(doc, data) {
  Object.keys(data).forEach(k => {
    const v = data[k];
    if (v && v.$cmd === 'inc') {
      setPath(doc, k, (Number(getPath(doc, k)) || 0) + v.v);
    } else {
      setPath(doc, k, clone(v));
    }
  });
}

function dupError(name, fields) {
  const err = new Error('DUPLICATE key: ' + name + ' ' + fields.join('+'));
  err.errMsg = 'DUPLICATE key: ' + name + ' ' + fields.join('+');
  return err;
}

function createCloud(options) {
  const opts = options || {};
  const persistPath = opts.persistPath || '';
  const fs = persistPath ? require('fs') : null;

  const store = {};
  let currentOpenid = 'openid-A';
  let idSeq = 1;

  // 有持久化文件就从磁盘恢复，这样重启服务数据还在，多个客户端也能看见同一份
  if (persistPath) {
    try {
      if (fs.existsSync(persistPath)) {
        const saved = JSON.parse(fs.readFileSync(persistPath, 'utf8'));
        Object.keys(saved).forEach(k => {
          store[k] = saved[k];
        });
      }
    } catch (e) {
      console.log('[mock-sdk] 读取持久化文件失败，从空库开始：', e.message);
    }
  }

  function flush() {
    if (!persistPath) return;
    try {
      fs.writeFileSync(persistPath, JSON.stringify(store, null, 2));
    } catch (e) {
      console.log('[mock-sdk] 写持久化文件失败：', e.message);
    }
  }

  const UNIQUE = {
    votes: [['offer_id', 'voter_id']],
    quota_ledger: [['user_id', 'reason', 'ref_id']]
  };

  function col(name) {
    if (!store[name]) store[name] = [];
    return store[name];
  }

  function checkUnique(name, doc) {
    const rules = UNIQUE[name] || [];
    rules.forEach(fields => {
      const hit = col(name).some(d => fields.every(f => d[f] === doc[f]));
      if (hit) throw dupError(name, fields);
    });
  }

  class Query {
    constructor(name, where) {
      this.name = name;
      this._where = where || {};
      this._order = null;
      this._limit = 100;
    }

    orderBy(field, dir) {
      this._order = { field: field, dir: dir || 'asc' };
      return this;
    }

    limit(n) {
      this._limit = n;
      return this;
    }

    _rows() {
      let rows = col(this.name).filter(d => match(d, this._where));
      if (this._order) {
        const f = this._order.field;
        const sign = this._order.dir === 'desc' ? -1 : 1;
        rows = rows.slice().sort((a, b) => (a[f] > b[f] ? sign : a[f] < b[f] ? -sign : 0));
      }
      return rows.slice(0, this._limit);
    }

    async get() {
      return { data: clone(this._rows()) };
    }

    async count() {
      return { total: col(this.name).filter(d => match(d, this._where)).length };
    }

    async update(payload) {
      const rows = col(this.name).filter(d => match(d, this._where));
      rows.forEach(d => applyUpdate(d, payload.data));
      flush();
      return { stats: { updated: rows.length } };
    }
  }

  function collection(name) {
    const api = {
      async add(payload) {
        const doc = clone(payload.data);
        if (!doc._id) doc._id = 'id_' + idSeq++;
        if (col(name).some(d => d._id === doc._id)) throw dupError(name, ['_id']);
        checkUnique(name, doc);
        col(name).push(doc);
        flush();
        return { _id: doc._id };
      },

      doc(id) {
        return {
          async get() {
            const hit = col(name).filter(d => d._id === id)[0];
            if (!hit) {
              const err = new Error('document.get:fail document does not exist');
              err.errCode = -1;
              throw err;
            }
            return { data: clone(hit) };
          },
          async update(payload) {
            const hit = col(name).filter(d => d._id === id)[0];
            if (!hit) return { stats: { updated: 0 } };
            applyUpdate(hit, payload.data);
            flush();
            return { stats: { updated: 1 } };
          },
          async remove() {
            const rows = col(name);
            const idx = rows.findIndex(d => d._id === id);
            if (idx >= 0) rows.splice(idx, 1);
            flush();
            return { stats: { removed: idx >= 0 ? 1 : 0 } };
          }
        };
      },

      where(cond) {
        return new Query(name, cond);
      },

      orderBy(field, dir) {
        return new Query(name, {}).orderBy(field, dir);
      },

      limit(n) {
        return new Query(name, {}).limit(n);
      },

      async get() {
        return new Query(name, {}).get();
      },

      async count() {
        return new Query(name, {}).count();
      }
    };

    return api;
  }

  const db = {
    collection: collection,
    command: {
      gt: v => cmd('gt', v),
      gte: v => cmd('gte', v),
      lt: v => cmd('lt', v),
      lte: v => cmd('lte', v),
      in: v => cmd('in', v),
      inc: v => cmd('inc', v)
    }
  };

  const cloud = {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database() {
      return db;
    },
    getWXContext() {
      return { OPENID: currentOpenid, APPID: 'wxtest' };
    },
    openapi: {
      security: {
        async msgSecCheck(opt) {
          const content = String(opt.content || '');
          if (content.indexOf('违规') >= 0 || content.indexOf('加微信') >= 0) {
            return { result: { suggest: 'risky', label: 20001 } };
          }
          if (content.indexOf('待审') >= 0) {
            return { result: { suggest: 'review', label: 20002 } };
          }
          return { result: { suggest: 'pass', label: 100 } };
        }
      }
    }
  };

  return {
    cloud: cloud,
    setUser(openid) {
      currentOpenid = openid;
    },
    rows(name) {
      return col(name);
    },
    flush() {
      flush();
    },
    reset() {
      Object.keys(store).forEach(k => delete store[k]);
      flush();
    }
  };
}

module.exports = { createCloud };
