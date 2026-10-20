const api = require('../../utils/api');

const STATUS = {
  published: { text: '审批中', cls: 'pending' },
  reviewing: { text: '审核中', cls: 'pending' },
  expired: { text: '待决定', cls: 'pending' },
  decided: { text: '已定', cls: 'done' },
  removed: { text: '已下架', cls: 'done' }
};

Page({
  data: {
    loading: true,
    error: '',
    offers: [],
    stats: { offers: 0, votes: 0 },
    quota: 0,
    mode: 'cloud'
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });

    try {
      const results = await Promise.all([api.call('offer.mine'), api.call('me.get')]);
      const mine = results[0];
      const me = results[1];

      const offers = (mine.items || []).map(o => {
        const s = STATUS[o.status] || STATUS.published;
        return {
          id: o.id,
          role: o.role,
          industry: o.industry,
          city: o.city,
          pkg: o.pkg,
          statusText: s.text,
          statusClass: s.cls,
          summary: '接 ' + o.tally.take + ' / 等等 ' + o.tally.wait + ' / 别接 ' + o.tally.drop
        };
      });

      this.setData({
        offers: offers,
        stats: me.stats,
        quota: me.quota.balance,
        loading: false,
        mode: api.mode()
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' });
    }
  },

  openOffer(e) {
    wx.navigateTo({
      url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id
    });
  },

  goSubmit() {
    wx.switchTab({ url: '/pages/submit/submit' });
  },

  retry() {
    this.load();
  },

  onReset() {
    if (api.mode() !== 'local') {
      wx.showToast({ title: '线上数据不能在这里清空', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '清空演示数据',
      content: '会删掉本地演示的 offer、投票和复盘，恢复成初始数据。',
      confirmText: '清空',
      confirmColor: '#AF3A2A',
      success: res => {
        if (!res.confirm) return;
        api.resetLocal();
        this.load();
        wx.showToast({ title: '已重置', icon: 'none' });
      }
    });
  }
});
