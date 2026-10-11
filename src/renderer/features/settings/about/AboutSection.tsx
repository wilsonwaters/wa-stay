import { useAppInfo, useCheckForUpdates } from '../../../api';
import { AboutPanel } from './AboutPanel';
import { UpdateCheckButton, UpdateCheckResult } from './UpdateCheck';

/**
 * Settings → About: the shared `AboutPanel` (version, links, logs folder, runtime details),
 * lined up with the section heading, with Settings' own update check in its actions row, the
 * check's result under it, and the data folder as selectable text.
 */
export function AboutSection() {
  const info = useAppInfo();
  const check = useCheckForUpdates();
  return (
    <AboutPanel align="start" actions={<UpdateCheckButton check={check} />}>
      <div className="flex flex-col gap-4">
        <UpdateCheckResult check={check} current={info.data?.version} />
        {info.data && (
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-semibold text-fg">Data folder</p>
            <p className="select-text break-all font-mono text-fg-secondary">
              {info.data.userDataPath}
            </p>
          </div>
        )}
      </div>
    </AboutPanel>
  );
}

export default AboutSection;
