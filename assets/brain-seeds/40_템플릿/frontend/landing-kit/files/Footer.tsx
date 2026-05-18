const sections = [
  {
    title: '제품',
    links: [
      { label: '기능', href: '#features' },
      { label: '요금', href: '#pricing' },
      { label: '문서', href: '#' },
      { label: '변경 로그', href: '#' },
    ],
  },
  {
    title: '회사',
    links: [
      { label: '소개', href: '#' },
      { label: '블로그', href: '#' },
      { label: '연락처', href: '#' },
    ],
  },
  {
    title: '법적 고지',
    links: [
      { label: '이용 약관', href: '#' },
      { label: '개인정보 처리방침', href: '#' },
    ],
  },
]

/* 브랜드 아이콘 모두 inline SVG (lucide 의존성 없음 — 라이브러리 변경에 안전) */
const GithubIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={p.className}>
    <path d="M12 .5C5.4.5 0 5.9 0 12.5c0 5.3 3.4 9.8 8.2 11.4.6.1.8-.3.8-.6V21c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.3-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2 1-.3 2-.4 3-.4s2 .1 3 .4c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.1.8.9 1.2 2 1.2 3.3 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6C20.6 22.3 24 17.8 24 12.5 24 5.9 18.6.5 12 .5z"/>
  </svg>
)
const XIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={p.className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)
const DocsIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={p.className}>
    <path d="M5 3.5A2.5 2.5 0 0 1 7.5 1H19v18H7.5A2.5 2.5 0 0 0 5 21.5v-18zM7.5 3A.5.5 0 0 0 7 3.5v14.55c.17-.03.33-.05.5-.05H17V3H7.5zM7.5 20A.5.5 0 0 0 7 20.5a.5.5 0 0 0 .5.5H19v2H7.5A2.5 2.5 0 0 1 5 20.5 2.5 2.5 0 0 1 7.5 18H19v2H7.5z" />
  </svg>
)

const socials = [
  { Icon: GithubIcon,  href: '#', label: 'GitHub' },
  { Icon: XIcon,       href: '#', label: 'X' },
  { Icon: DocsIcon,    href: '#', label: 'Docs' },
]

export default function Footer() {
  return (
    <footer className="px-6 py-12 border-t border-gray-200">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          <div className="col-span-2 md:col-span-1">
            <h3 className="font-bold text-gray-900 mb-3">
              {/* TODO: 회사·제품 이름 */}
              Haram AI Agent
            </h3>
            <p className="text-sm text-gray-500 leading-relaxed">
              {/* TODO: 한 줄 소개 */}
              로컬 AI 소프트웨어 회사. 기획부터 QA까지 한 흐름으로.
            </p>
          </div>
          {sections.map((s) => (
            <div key={s.title}>
              <h4 className="font-semibold text-gray-900 text-sm mb-3">{s.title}</h4>
              <ul className="space-y-2">
                {s.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className="text-sm text-gray-500 hover:text-gray-900 transition">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-8 border-t border-gray-100">
          <p className="text-sm text-gray-500">
            © {new Date().getFullYear()} Haram AI Agent. All rights reserved.
          </p>
          <div className="flex gap-4">
            {socials.map(({ Icon, href, label }) => (
              <a
                key={label}
                href={href}
                aria-label={label}
                className="text-gray-400 hover:text-gray-900 transition"
              >
                <Icon className="w-5 h-5" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
