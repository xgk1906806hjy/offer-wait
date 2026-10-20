const { E, AppError } = require('../errors');
const social = require('../repo/social');
const offersRepo = require('../repo/offers');
const votesRepo = require('../repo/votes');

async function get(openid) {
  const user = await social.getUser(openid);
  if (!user) throw new AppError(E.UNAUTH, '用户不存在');

  const [balance, ledger, offerCount, voteCount] = await Promise.all([
    social.getBalance(openid),
    social.listLedger(openid, 20),
    offersRepo.countOffersByAuthorSince(openid, 0),
    votesRepo.countByVoter(openid)
  ]);

  return {
    profile: {
      nickname: user.nickname || '',
      industry: user.industry || '',
      role: user.role || '',
      years: user.years || 0,
      verify_status: user.verify_status || 'none',
      weight: user.weight,
      is_admin: !!user.is_admin,
      status: user.status
    },
    quota: {
      balance: balance,
      need_to_publish: Math.max(0, 3 - balance),
      ledger: ledger.map(r => ({
        delta: r.delta,
        reason: r.reason,
        created_at: r.created_at
      }))
    },
    stats: {
      offers: offerCount,
      votes: voteCount
    }
  };
}

module.exports = { get };
