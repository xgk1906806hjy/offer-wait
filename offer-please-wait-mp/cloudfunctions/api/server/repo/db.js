const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const C = {
  users: 'users',
  offers: 'offers',
  questions: 'offer_questions',
  votes: 'votes',
  answers: 'vote_answers',
  reviews: 'reviews',
  ledger: 'quota_ledger',
  tasks: 'moderation_tasks',
  reports: 'reports',
  templates: 'templates'
};

/** 云数据库的“重复键”错误没有稳定错误码，只能靠特征判断 */
function isDuplicate(err) {
  const msg = String((err && (err.errMsg || err.message)) || '');
  return msg.indexOf('duplicate') >= 0 || msg.indexOf('DUPLICATE') >= 0 || msg.indexOf('已存在') >= 0;
}

module.exports = { cloud, db, _, C, isDuplicate };
