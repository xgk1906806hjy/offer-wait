const api = require('../../utils/api');
const { CODES } = require('../../utils/api-error');

Page({
  data: {
    role: '',
    industry: '',
    city: '',
    company: '',
    pkg: '',
    dilemma: '',
    asked: '',

    hoursList: ['24 小时', '48 小时', '3 天', '一周'],
    hoursValue: [24, 48, 72, 168],
    hoursIndex: 1,

    altList: ['没有，就这一个', '在等另一家', '手上还有一个'],
    altKeys: ['none', 'pending', 'have'],
    altIndex: 0,

    submitting: false,
    mode: 'cloud'
  },

  onShow() {
    if (this.resetAfterSubmit) {
      this.resetAfterSubmit = false;
      this.setData({
        role: '',
        industry: '',
        city: '',
        company: '',
        pkg: '',
        dilemma: '',
        asked: '',
        hoursIndex: 1,
        altIndex: 0,
        mode: api.mode()
      });
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const patch = {};
    patch[field] = e.detail.value;
    this.setData(patch);
  },

  onHours(e) {
    this.setData({ hoursIndex: Number(e.detail.value) });
  },

  onAlt(e) {
    this.setData({ altIndex: Number(e.detail.value) });
  },

  async onSubmit() {
    if (this.data.submitting) return;

    const d = this.data;
    const role = (d.role || '').trim();
    const industry = (d.industry || '').trim();
    const dilemma = (d.dilemma || '').trim();

    if (!role) {
      wx.showToast({ title: '先写岗位', icon: 'none' });
      return;
    }
    if (!industry) {
      wx.showToast({ title: '行业也要写，不然没人能判断这家公司', icon: 'none' });
      return;
    }
    if (dilemma.length < 8) {
      wx.showToast({ title: '把纠结写具体一点', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });

    try {
      const res = await api.call('offer.create', {
        role: role,
        industry: industry,
        city: (d.city || '').trim(),
        company: (d.company || '').trim(),
        pkg: (d.pkg || '').trim(),
        dilemma: dilemma,
        alternatives: d.altKeys[d.altIndex],
        asked: (d.asked || '').trim(),
        ttl_hours: d.hoursValue[d.hoursIndex]
      });

      this.resetAfterSubmit = true;
      wx.navigateTo({ url: '/pages/detail/detail?id=' + res.id });
    } catch (err) {
      if (err.code === CODES.NO_QUOTA) {
        wx.showModal({
          title: '还差几份审批',
          content: err.message + '。去广场审几份别人的 offer，就能发自己的了。',
          confirmText: '去广场',
          success: r => {
            if (r.confirm) wx.switchTab({ url: '/pages/plaza/plaza' });
          }
        });
      } else if (err.code === CODES.CONTENT_REJECTED) {
        wx.showModal({
          title: '没通过安全检测',
          content: '改一下措辞再发。别写具体公司名，也别带联系方式。',
          showCancel: false
        });
      } else {
        wx.showToast({ title: err.message, icon: 'none' });
      }
    } finally {
      this.setData({ submitting: false });
    }
  }
});
