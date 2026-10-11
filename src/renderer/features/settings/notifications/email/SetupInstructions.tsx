import { SMTPPreset } from '../../../../../shared/types/notifier.types';
import { ExternalLink } from '../../../../components/ExternalLink';
import { Disclosure } from '../../../../components/ui';

const STEPS: Record<
  SMTPPreset,
  { intro?: string; link?: { href: string; label: string }; steps: string[]; note?: string }
> = {
  [SMTPPreset.GMAIL]: {
    link: { href: 'https://myaccount.google.com', label: 'Open your Google Account' },
    steps: [
      'In your Google Account, open Security.',
      'Under "How you sign in to Google", turn on 2-Step Verification if it is off.',
      'Back in Security, find "App passwords" (you may need to sign in again).',
      'Create an app password, then copy it. It is shown once.',
      'Paste it into App password above, with or without its spaces.',
    ],
    note: 'App passwords exist only while 2-Step Verification is on.',
  },
  [SMTPPreset.OUTLOOK]: {
    link: {
      href: 'https://account.microsoft.com/security',
      label: 'Open your Microsoft account security',
    },
    steps: [
      'Open "Advanced security options".',
      'Turn on two-step verification if it is off.',
      'Under "App passwords", create a new app password and copy it. It is shown once.',
      'Paste it into App password above.',
    ],
    note: 'If there is no App passwords option, your organisation may have turned it off. Ask your IT administrator.',
  },
  [SMTPPreset.CUSTOM]: {
    intro:
      'Ask your mail provider for its SMTP server, port and security setting, and the user name and password to sign in with.',
    steps: [],
  },
};

/** How to get the password the mail service wants, for the chosen preset. */
export function SetupInstructions({ preset }: { preset: SMTPPreset }) {
  const guide = STEPS[preset];
  return (
    <Disclosure
      summary={
        preset === SMTPPreset.CUSTOM
          ? 'What you need from your mail provider'
          : 'How to get an app password'
      }
    >
      <div className="flex flex-col gap-3 pt-1">
        {guide.intro && <p>{guide.intro}</p>}
        {guide.link && (
          <p>
            <ExternalLink href={guide.link.href}>{guide.link.label}</ExternalLink>
          </p>
        )}
        {guide.steps.length > 0 && (
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
        {guide.note && <p className="text-fg-muted">{guide.note}</p>}
      </div>
    </Disclosure>
  );
}

export default SetupInstructions;
