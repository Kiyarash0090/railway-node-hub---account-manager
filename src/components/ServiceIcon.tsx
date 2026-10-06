import React from 'react';

/** True when the icon value is a remote image URL (cdn/jsdelivr/etc.). */
export function isIconUrl(icon?: string | null): boolean {
  return !!icon && /^https?:\/\//i.test(icon.trim());
}

/**
 * Renders a Railway service icon.
 * - URL icons (e.g. https://cdn.jsdelivr.net/gh/selfhst/icons/svg/9router.svg)
 *   are shown as a real <img>, not as raw URL text.
 * - Anything else (emoji / short label) is rendered as text, same as before.
 */
export const ServiceIcon: React.FC<{
  icon?: string | null;
  className?: string;
  imgClassName?: string;
  alt?: string;
}> = ({ icon, className = '', imgClassName = '', alt = '' }) => {
  const value = (icon || '').trim();

  if (isIconUrl(value)) {
    return (
      <span className={`inline-flex items-center justify-center ${className}`}>
        <img
          src={value}
          alt={alt || 'service-icon'}
          className={`h-5 w-5 object-contain ${imgClassName}`}
          loading="lazy"
          onError={(e) => {
            // Fall back to a generic glyph if the CDN icon fails to load.
            const el = e.currentTarget;
            el.style.display = 'none';
            const sibling = el.parentElement?.querySelector('[data-icon-fallback]');
            if (sibling) (sibling as HTMLElement).style.display = 'inline';
          }}
        />
        <span data-icon-fallback style={{ display: 'none' }} className="text-base">
          ⚡
        </span>
      </span>
    );
  }

  return <span className={className}>{value || '⚡'}</span>;
};
