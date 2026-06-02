import { useEffect, useState } from 'react';

type HistoryAvatarProps = {
  username: string;
  profilePicUrl?: string;
};

export function HistoryAvatar({ username, profilePicUrl }: HistoryAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const letter = username.slice(0, 1).toUpperCase();
  const src = profilePicUrl?.trim();

  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  const showPhoto = Boolean(src) && !imgFailed;

  return (
    <span
      className={`account-avatar ${showPhoto ? 'account-avatar--photo' : ''}`}
      aria-hidden
    >
      {showPhoto ? (
        <img
          src={src}
          alt=""
          className="account-avatar-img"
          onError={() => setImgFailed(true)}
        />
      ) : (
        letter
      )}
    </span>
  );
}
