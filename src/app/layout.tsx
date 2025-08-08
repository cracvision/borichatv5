import React from "react";

export const metadata = {
  title: "Borí Cano Chat",
  description: "Chat del Borí Cano — server-reliable",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
