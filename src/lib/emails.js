'use strict';
/* Plain, brand-coloured transactional emails (HTML + text versions). */
const config = require('../config');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pkr = (n) => 'PKR ' + Number(n).toLocaleString('en-US');

function layout(title, inner) {
  return `<!doctype html><html><body style="margin:0;background:#F9FBFA;font-family:Arial,Helvetica,sans-serif;color:#0E1B14">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #DAE4DD;border-radius:16px">
<tr><td style="padding:22px 28px;border-bottom:1px solid #EAF0EC"><strong style="font-size:20px;color:#01411C">Paklance</strong></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3">${esc(title)}</h1>
${inner}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #EAF0EC;color:#63756B;font-size:12px">Paklance · ${esc(config.appUrl.replace(/^https?:\/\//, ''))}</td></tr>
</table></td></tr></table></body></html>`;
}
const p = (t) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${t}</p>`;
const btn = (href, label) =>
  `<p style="margin:20px 0"><a href="${esc(href)}" style="display:inline-block;background:#01411C;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">${esc(label)}</a></p>`;
const small = (t) => `<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#63756B">${t}</p>`;

module.exports = {
  verifyCode(code) {
    const mins = config.auth.codeTtlMinutes;
    return {
      subject: `${code} is your Paklance verification code`,
      text: `Your Paklance verification code is ${code}.\n\nIt expires in ${mins} minutes. If you didn't try to sign up, you can ignore this email.`,
      html: layout('Verify your email', p('Enter this code to finish creating your Paklance account:') +
        `<p style="margin:18px 0;font-size:32px;font-weight:bold;letter-spacing:8px;color:#01411C">${esc(code)}</p>` +
        small(`It expires in ${mins} minutes. If you didn’t try to sign up, you can ignore this email.`))
    };
  },

  passwordReset(link) {
    const mins = config.auth.resetTtlMinutes;
    return {
      subject: 'Reset your Paklance password',
      text: `Use this link to choose a new password:\n${link}\n\nThe link expires in ${mins} minutes. If you didn't ask to reset your password, you can ignore this email.`,
      html: layout('Reset your password', p('We received a request to reset the password for your Paklance account.') +
        btn(link, 'Choose a new password') +
        small(`The link expires in ${mins} minutes. If you didn’t ask for this, you can ignore this email and your password won’t change.`))
    };
  },

  resetForGoogleAccount() {
    return {
      subject: 'Signing in to Paklance',
      text: `Someone asked to reset the password for this email. Your Paklance account signs in with Google, so there's no password to reset. Use "Continue with Google" on ${config.appUrl}.`,
      html: layout('Your account uses Google sign-in', p('Someone asked to reset the password for this email address.') +
        p('Your Paklance account signs in with Google, so there’s no password to reset. Use <b>Continue with Google</b> instead.') +
        btn(config.appUrl, 'Go to Paklance'))
    };
  },

  newsletterWelcome(unsubscribeLink) {
    return {
      subject: 'You’re subscribed to the Paklance newsletter',
      text: `Thanks for subscribing. We'll send practical freelancing, hiring and global work insights to this address.\n\nUnsubscribe any time: ${unsubscribeLink}`,
      html: layout('Thanks for subscribing', p('We’ll send practical freelancing, hiring and global work insights to this address.') +
        btn(config.appUrl + '/#blog', 'Read the blog') +
        small(`Don’t want these emails? <a href="${esc(unsubscribeLink)}" style="color:#0A5C2E">Unsubscribe</a>.`))
    };
  },

  fundingInstructions({ reference, method, amount, fee, total, milestoneTitle, contractTitle, bank }) {
    const rows = [
      ['Milestone', `${milestoneTitle} (${contractTitle})`],
      ['Milestone amount', pkr(amount)],
      ['Service fee', pkr(fee)],
      ['Total to transfer', pkr(total)],
      method === 'raast' && bank.raastId ? ['Raast ID', bank.raastId] : ['IBAN', bank.iban],
      ['Account title', bank.accountTitle],
      bank.bankName ? ['Bank', bank.bankName] : null,
      ['Reference', reference]
    ].filter(Boolean);
    return {
      subject: `Fund your milestone: transfer ${pkr(total)} (ref ${reference})`,
      text: `To fund this milestone, transfer the total below to Paklance's escrow account and put the reference in the transfer description.\n\n${rows
        .map((r) => `${r[0]}: ${r[1]}`)
        .join('\n')}\n\nThe milestone shows as funded once the transfer is confirmed. JazzCash and Easypaisa are coming soon.`,
      html: layout('Fund your milestone', p('To fund this milestone, transfer the total below to Paklance’s escrow account and put the reference in the transfer description.') +
        `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse;margin:6px 0 10px">${rows
          .map((r) => `<tr><td style="padding:6px 0;color:#63756B">${esc(r[0])}</td><td style="padding:6px 0;text-align:right;font-weight:bold">${esc(r[1])}</td></tr>`)
          .join('')}</table>` +
        small('The milestone shows as funded once the transfer is confirmed. JazzCash and Easypaisa are coming soon, once merchant onboarding is complete.'))
    };
  },

  seminarRegistered(s, name) {
    const when = new Date(s.starts_at).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true }) + ' (Pakistan time)';
    const where = s.details || s.place;
    const first = String(name || '').split(' ')[0];
    return {
      subject: `You’re registered: ${s.title}`,
      text: `${first ? 'Hi ' + first + ',\n\n' : ''}You're registered for "${s.title}".\n\nWhen: ${when}\nLength: ${s.minutes} minutes\nWhere: ${where}\n\n${s.details ? '' : 'We\'ll email the joining link or venue details before the session.\n\n'}Before you come, read the guide: ${config.appUrl}/blog/how-to-record-your-video-introduction`,
      html: layout('You’re registered', p(`You’re registered for <b>${esc(s.title)}</b>.`) +
        `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse;margin:6px 0 10px">${[['When', when], ['Length', s.minutes + ' minutes'], ['Where', where]]
          .map((r) => `<tr><td style="padding:6px 0;color:#63756B;vertical-align:top">${esc(r[0])}</td><td style="padding:6px 0;text-align:right;font-weight:bold">${esc(r[1])}</td></tr>`)
          .join('')}</table>` +
        (s.details ? '' : small('We’ll email the joining link or venue details before the session.')) +
        btn(config.appUrl + '/blog/how-to-record-your-video-introduction', 'Read the recording guide'))
    };
  },

  withdrawalRequested({ amount, channel, masked }) {
    return {
      subject: `Withdrawal request received: ${pkr(amount)}`,
      text: `We've received your request to withdraw ${pkr(amount)} to ${channel === 'raast' ? 'Raast' : 'bank account'} ${masked}. The amount is locked until it is processed through 1Link interbank clearing.`,
      html: layout('Withdrawal request received', p(`We’ve received your request to withdraw <b>${esc(pkr(amount))}</b> to ${channel === 'raast' ? 'Raast' : 'bank account'} ${esc(masked)}.`) +
        small('The amount is locked until it is processed through 1Link interbank clearing.'))
    };
  }
};
