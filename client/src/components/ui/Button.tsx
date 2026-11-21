import type { ButtonHTMLAttributes } from 'react';
type ButtonProps=ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'quiet'};
const variants={primary:'button button-primary',secondary:'button button-secondary',quiet:'button button-quiet'};
export function Button({variant='primary',className='',...props}:ButtonProps){return <button className={`${variants[variant]} ${className}`.trim()} {...props}/>;}
