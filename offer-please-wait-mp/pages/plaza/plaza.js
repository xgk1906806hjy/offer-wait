const api = require('../../utils/api');
const fmt = require('../../utils/format');

/** 服务端返回的裸数据 → 页面用的视图数据。倒计时在这里算，基于服务端时间 */
function decorate(o, votedIds) {
  const c = fmt.countdown(o.deadline_at);
  return {
    id: o.id,
    role: o.role,
    industry: o.industry,
    city: o.city,
    company: o.company,
    pkg: o.pkg,
    dilemma: o.dilemma,
    voteCount: o.vote_count,
    voted: (votedIds || []).indexOf(o.id) >= 0,
    remain: c.remain,
    urgent: c.urgent,
    over: c.over
  };
}

Page({
  data: {
    loading: true,
    error: '',
    items: [],
    hasMore: false,
    mode: 'cloud'
  },

  onLoad() {
    this.raw = [];
    this.votedIds = [];
    this.cursor = '';
  },

  onShow() {
    this.reload();
  },

  onHide() {
    this.stopTick();
  },

  onUnload() {
    this.stopTick();
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    this.reload()
      .then(done)
      .catch(done);
  },

  onReachBottom() {
    this.loadMore();
  },

  async reload() {
    this.setData({ loading: true, error: '' });
    this.stopTick();

    try {
      const res = await api.call('offer.list', { limit: 20 });
      this.raw = res.items || [];
      this.votedIds = res.voted_ids || [];
      this.cursor = res.next_cursor || '';

      this.setData({
        items: this.raw.map(o => decorate(o, this.votedIds)),
        hasMore: !!this.cursor,
        loading: false,
        mode: api.mode()
      });

      this.startTick();
    } catch (err) {
      this.setData({
        loading: false,
        error: err.message || '加载失败',
        mode: api.mode()
      });
    }
  },

  async loadMore() {
    if (!this.data.hasMore || this._loadingMore) return;
    this._loadingMore = true;

    try {
      const res = await api.call('offer.list', {
        limit: 20,
        cursor: this.cursor
      });
      this.raw = this.raw.concat(res.items || []);
      this.votedIds = this.votedIds.concat(res.voted_ids || []);
      this.cursor = res.next_cursor || '';

      this.setData({
        items: this.raw.map(o => decorate(o, this.votedIds)),
        hasMore: !!this.cursor
      });
    } catch (e) {
      wx.showToast({ title: '加载失败，稍后再试', icon: 'none' });
    } finally {
      this._loadingMore = false;
    }
  },

  startTick() {
    this.stopTick();
    this.timer = setInterval(() => {
      this.setData({ items: this.raw.map(o => decorate(o, this.votedIds)) });
    }, 30000);
  },

  stopTick() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  retry() {
    this.reload();
  },

  openOffer(e) {
    wx.navigateTo({
      url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id
    });
  }
});
