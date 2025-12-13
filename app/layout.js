import './globals.css'

export const metadata = {
  title: 'Wukaninchen Stundenerfassung',
  description: 'Arbeitszeiterfassung für Wukaninchen e.V.',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  )
}
