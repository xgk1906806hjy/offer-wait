const api = require('./utils/api');

App({
  onLaunch() {
    // 云开发可用就走云函数；没配好会自动降级成本地演示，页面不需要关心
    api.init();
  },

  globalData: {
    mode: 'cloud'
  }
});
