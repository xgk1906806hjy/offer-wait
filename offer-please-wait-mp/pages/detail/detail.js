const api = require('../../utils/api');
const fmt = require('../../utils/format');

const LABEL = { take: '接', wait: '再等等', drop: '别接' };
const ALT = { none: '没有，就这一个', pending: '在等另一家', have: '手上还有一个' };

function shapeResult(r) {
  const total = r.total || 0;
  const tally = r.tally || { take: 0, wait: 0, drop: 0 };

  let verdictKey = 'wait';
  if (total) {
    if (tally.wait >= tally.take && tally.wait >= tally.drop) verdictKey = 'wait';
    else if (tally.take >= tally.drop) verdictKey = 'take';
    else verdictKey = 'drop';
  }

  return {
    total: total,
    tally: tally,
    barTake: total ? Math.round((tally.take / total) * 100) : 0,
    barWait: total ? Math.round((tally.wait / total) * 100) : 0,
    barDrop: total ? Math.round((tally.drop / total) * 100) : 0,
    verdictKey: total ? verdictKey : '',
    verdictLabel: total ? (verdictKey === 'take' ? '可接' : verdictKey === 'wait' ? '再等等' : '别接') : '',
    votes: (r.votes || []).map((v, i) => ({
      idx: i,
      choice: v.choice,
      label: LABEL[v.choice],
      reason: v.reason,
      mine: !!v.is_mine,
      answers: v.answers || []
    })),
    openQuestions: r.open_questions || []
  };
}

Page({
  data: {
    id: '',
    loading: true,
    error: '',
    offer: null,
    questions: [],
    viewer: null,
    myVote: null,
    result: null,
    choice: '',
    reason: '',
    answers: [],
    submitting: false,
    mode: 'cloud'
  },

  onLoad(options) {
    this.setData({ id: (options && options.id) || '' });
  },

  onShow() {
    this.load();
    this.startTick();
  },

  onHide() {
    this.stopTick();
  },

  onUnload() {
    this.stopTick();
  },

  async load() {
    if (!this.data.id) {
      this.setData({ loading: false, error: '缺少参数' });
      return;
    }

    try {
      const d = await api.call('offer.detail', { id: this.data.id });
      const c = fmt.countdown(d.offer.deadline_at);

      const patch = {
        loading: false,
        error: '',
        offer: Object.assign({}, d.offer, {
          altLabel: ALT[d.offer.alternatives] || '',
          remain: c.remain,
          urgent: c.urgent,
          over: c.over
        }),
        questions: d.questions || [],
        viewer: d.viewer,
        myVote: d.my_vote,
        result: d.result ? shapeResult(d.result) : null,
        mode: api.mode()
      };

      if (!d.viewer.has_voted) {
        patch.choice = '';
        patch.reason = '';
        patch.answers = (d.questions || []).map(() => '');
      }

      this.setData(patch);
    } catch (err) {
      this.setData({
        loading: false,
        error: err.message || '加载失败'
      });
    }
  },

  startTick() {
    this.stopTick();
    this.timer = setInterval(() => {
      const o = this.data.offer;
      if (!o) return;
      const c = fmt.countdown(o.deadline_at);
      this.setData({
        'offer.remain': c.remain,
        'offer.urgent': c.urgent,
        'offer.over': c.over
      });
    }, 30000);
  },

  stopTick() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  onChoose(e) {
    this.setData({ choice: e.currentTarget.dataset.k });
  },

  onReason(e) {
    this.setData({ reason: e.detail.value });
  },

  onAnswer(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const answers = this.data.answers.slice();
    answers[idx] = e.detail.value;
    this.setData({ answers: answers });
  },

  async submitVote() {
    if (this.data.submitting) return;

    if (!this.data.choice) {
      wx.showToast({ title: '先选一个判断', icon: 'none' });
      return;
    }

    const reason = (this.data.reason || '').trim();
    if (reason.length < 10) {
      wx.showToast({ title: '理由至少 10 个字', icon: 'none' });
      return;
    }

    const answers = [];
    (this.data.answers || []).forEach((text, i) => {
      const t = String(text || '').trim();
      if (t) answers.push({ seq: i + 1, text: t });
    });

    if (!answers.length) {
      wx.showToast({ title: '至少回答一个问题', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });

    try {
      await api.call('vote.create', {
        id: this.data.id,
        choice: this.data.choice,
        reason: reason,
        answers: answers
      });
      await this.load();
      wx.showToast({ title: '已提交，现在能看到别人的判断了', icon: 'none' });
    } catch (err) {
      if (err.code === 40302 || err.code === 40901) {
        await this.load();
      }
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async onDecide(e) {
    const decision = e.currentTarget.dataset.d;

    try {
      await api.call('offer.decide', { id: this.data.id, decision: decision });
      await this.load();
      wx.showToast({ title: '记下了，三个月后回来复盘', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  onReview() {
    const id = this.data.id;

    wx.showModal({
      title: '三个月后再看一次',
      editable: true,
      placeholderText: '当时哪句话真的帮到你了？',
      confirmText: '存下',
      cancelText: '先不填',
      success: async res => {
        if (!res.confirm) return;
        try {
          await api.call('review.create', { id: id, text: (res.content || '').trim() });
          wx.showToast({ title: '复盘已存', icon: 'none' });
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      }
    });
  },

  retry() {
    this.setData({ loading: true });
    this.load();
  },

  goPlaza() {
    wx.navigateBack({
      fail() {
        wx.switchTab({ url: '/pages/plaza/plaza' });
      }
    });
  }
});
