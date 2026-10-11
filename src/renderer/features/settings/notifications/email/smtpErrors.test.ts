import { NOTIFIER_SECRET_UNREADABLE } from '../../../../../shared/types/notifier.types';
import { friendlySmtpError } from './smtpErrors';

const SERVER = { host: '127.0.0.1', port: 2599 };

describe('friendlySmtpError', () => {
  it.each([
    [
      'Error: connect ECONNREFUSED 127.0.0.1:2599',
      "Couldn't reach the mail server at 127.0.0.1:2599.",
    ],
    ['read ECONNRESET', "Couldn't reach the mail server at 127.0.0.1:2599."],
    [
      'getaddrinfo ENOTFOUND smtp.exmaple.com',
      "Couldn't find the mail server 127.0.0.1. Check its name.",
    ],
    ['Connection timeout', "The mail server at 127.0.0.1:2599 didn't answer in time."],
    ['Greeting never received', "The mail server at 127.0.0.1:2599 didn't answer in time."],
    [
      'Invalid login: 535-5.7.8 Username and Password not accepted',
      "The mail server didn't accept the account or password.",
    ],
    ['EAUTH', "The mail server didn't accept the account or password."],
    [
      'self-signed certificate in certificate chain',
      "Couldn't make a secure connection to 127.0.0.1:2599. Check the security setting.",
    ],
    [
      'C0E7:error:0A00010B:SSL routines:ssl3_get_record:wrong version number',
      "Couldn't make a secure connection to 127.0.0.1:2599. Check the security setting.",
    ],
    ['something nobody expected', "The test email couldn't be sent."],
    [undefined, "The test email couldn't be sent."],
  ])('%s → %s', (raw, friendly) => {
    expect(friendlySmtpError(raw, SERVER)).toBe(friendly);
  });

  it('an unreadable saved password asks for it again', () => {
    expect(friendlySmtpError(NOTIFIER_SECRET_UNREADABLE, {})).toBe(
      "The saved password couldn't be read on this computer. Enter it again."
    );
  });

  it('never repeats the raw error code', () => {
    expect(
      friendlySmtpError('connect ECONNREFUSED 10.0.0.1:25', { host: 'mail.x.au', port: 25 })
    ).not.toMatch(/ECONNREFUSED/);
  });
});
