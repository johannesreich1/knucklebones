import type { LegalContentBlock, LegalLocaleContent } from '../types.ts';

const p = (text: string): LegalContentBlock => ({ kind: 'paragraph', text });
const list = (...items: string[]): LegalContentBlock => ({ kind: 'list', items });

export const ES_LEGAL: LegalLocaleContent = {
  siteTitle: 'Información legal de Knucklebones Neon',
  languageLabel: 'Idioma',
  pageNavigationLabel: 'Información legal',
  languageNavigationLabel: 'Idiomas disponibles',
  homeLabel: 'Volver al juego',
  backLabel: 'Volver',
  pendingFact: 'Pendiente de verificación antes de publicarse',
  pages: {
    imprint: {
      title: 'Información del responsable',
      shortTitle: 'Aviso legal',
      description: 'Datos del responsable y de contacto de Knucklebones Neon.',
      intro: 'Información de la persona responsable de este proyecto de juego privado y no comercial.',
      sections: [
        { heading: 'Responsable según § 18(1) MStV', blocks: [p('{{controllerName}}\n{{controllerStreet}}\n{{controllerPostalCity}}\n{{controllerCountry}}')] },
        { heading: 'Contacto', blocks: [p('Correo electrónico: {{publicEmail}}')] },
        { heading: 'Situación del proyecto', blocks: [p('Este es un proyecto personal gratuito gestionado por una persona física. No hay empresa, inscripción mercantil, número de IVA, profesión regulada, publicidad ni oferta de pago que deban indicarse.')] },
      ],
    },
    privacy: {
      title: 'Aviso de privacidad',
      shortTitle: 'Privacidad',
      description: 'Cómo trata Knucklebones Neon los datos del dispositivo, la cuenta y las partidas clasificatorias.',
      intro: 'Este aviso describe los datos usados en el juego sin conexión, la PWA alojada y las partidas clasificatorias opcionales.',
      sections: [
        { heading: 'Responsable y contacto', blocks: [p('{{controllerName}}, {{controllerStreet}}, {{controllerPostalCity}}, {{controllerCountry}}. Correo electrónico: {{publicEmail}}.')] },
        { heading: 'Datos en tu dispositivo', blocks: [p('Las preferencias, estadísticas locales, sesión y copia en caché del perfil permanecen en el almacenamiento local del navegador o WebView. La PWA alojada usa además Cache Storage para archivos sin conexión y un valor temporal de sesión para recuperarse de cargas fallidas. No usamos cookies publicitarias ni de marketing.')] },
        { heading: 'Cuenta y partidas clasificatorias', blocks: [p('Al iniciar una partida clasificatoria se crea una cuenta anónima de Supabase. Tratamos un identificador de cuenta, apodo generado o elegido, código de avatar, ajustes, valor actual y máximo de la puntuación o valoración, datos de clasificación, fecha de creación del perfil e historial de partidas y movimientos. Si eliges recuperación por correo, Supabase Auth guarda también esa dirección y {{smtpProvider}} entrega los mensajes relacionados.')] },
        { heading: 'Fines y bases jurídicas', blocks: [p('Tratamos datos de cuenta, emparejamiento, partida, ajustes y clasificación para prestar el servicio solicitado y conservar sus resultados (art. 6.1.b del RGPD).'), p('Tratamos datos operativos y de seguridad limitados para evitar abusos, aplicar límites, diagnosticar fallos y proteger el servicio y a otros jugadores (art. 6.1.f del RGPD).')] },
        { heading: 'Destinatarios, regiones y transferencias', blocks: [p('Supabase presta autenticación, base de datos, Edge Functions y Realtime. La región de la base de datos es {{supabaseDatabaseRegion}} y la de Edge Functions es {{supabaseFunctionsRegion}}.'), p('Cloudflare Pages entrega la PWA alojada. El alcance relevante del tratamiento es: {{cloudflareProcessingScope}}.'), p('Las garantías aplicables a transferencias internacionales son: {{transferSafeguards}}. La aplicación nativa carga archivos web incluidos en su paquete.'), p('No integramos SDK de publicidad o análisis de comportamiento ni scripts remotos de marketing o análisis. Los proveedores de infraestructura pueden crear registros operativos, de seguridad y de acceso.')] },
        { heading: 'Lo que pueden ver otros jugadores', blocks: [p('Apodo, avatar, valor actual y máximo de la puntuación o valoración, puesto o pertenencia al 1 % superior, victorias, derrotas, partidas, mejor racha, fecha de alta y resultados de partidas clasificatorias pueden mostrarse a rivales o en la clasificación y fichas de jugador. El historial detallado se limita al titular; quienes participaron pueden leer su registro compartido de partida y movimientos.')] },
        { heading: 'Conservación y eliminación', blocks: [p('Las cuentas de invitado o recuperadas permanecen hasta su eliminación. Tras resolver una partida activa, la eliminación borra perfil, ajustes, filas de clasificación y cola e historial de partidas y movimientos. Las preferencias y estadísticas locales siguen en el dispositivo hasta borrar los datos de la app o del sitio. Los registros de seguridad se conservan {{securityLogRetention}} y las copias de seguridad {{backupRetention}}.')] },
        { heading: 'Tus derechos', blocks: [p('Puedes solicitar acceso, rectificación, supresión, limitación, portabilidad u oponerte al tratamiento escribiendo a {{publicEmail}}. También puedes reclamar ante una autoridad de control.'), p('Autoridad competente: {{authorityName}}, {{authorityStreet}}, {{authorityPostalCity}}, {{authorityCountry}}.')] },
        { heading: 'Menores e información de edad', blocks: [p('Actualmente el juego no tiene control de edad ni solicita o guarda la fecha de nacimiento. Esto describe el comportamiento actual del producto; no afirma que se cumplan automáticamente las normas de privacidad infantil de todos los países.')] },
      ],
    },
    support: {
      title: 'Asistencia y contacto',
      shortTitle: 'Asistencia',
      description: 'Cómo pedir ayuda técnica, de privacidad o de cuenta para Knucklebones Neon.',
      intro: 'Usa el siguiente contacto para ayuda técnica, solicitudes de privacidad o dudas de cuenta.',
      sections: [
        { heading: 'Contacto', blocks: [p('Correo electrónico: {{publicEmail}}')] },
        { heading: 'En qué podemos ayudar', blocks: [list('Problemas técnicos y de accesibilidad', 'Dudas sobre la cuenta para partidas clasificatorias o el apodo', 'Derechos de privacidad y eliminación de cuenta', 'Avisos de abuso o problemas de seguridad')] },
        { heading: 'Qué debes incluir', blocks: [p('Describe lo ocurrido y la versión web o de la aplicación utilizada. Incluye el apodo o correo confirmado solo si es necesario. Las capturas ayudan si no muestran datos privados de otra persona.')] },
        { heading: 'Protege tus credenciales', blocks: [p('Nunca envíes contraseñas, enlaces de acceso, tokens de acceso o recuperación ni datos privados ajenos. No te pediremos esas credenciales por correo.')] },
        { heading: 'Gestión de solicitudes', blocks: [p('Usamos solo los datos necesarios para investigar. Las solicitudes de privacidad y eliminación requieren una comprobación proporcionada de titularidad: {{deletionVerification}}.')] },
      ],
    },
    'delete-account': {
      title: 'Eliminar tu cuenta',
      shortTitle: 'Eliminar cuenta',
      description: 'Instrucciones dentro y fuera de la aplicación para eliminar una cuenta para partidas clasificatorias de Knucklebones Neon.',
      intro: 'Eliminar la cuenta para partidas clasificatorias es permanente. Los datos locales sin conexión se borran por separado.',
      sections: [
        { heading: 'Eliminar en la aplicación', blocks: [list('Abre Perfil desde Inicio.', 'Abre los controles de la cuenta.', 'Elige Eliminar cuenta y revisa el aviso.', 'Confirma la eliminación permanente.')] },
        { heading: 'Datos eliminados del servidor', blocks: [p('Tras resolver una partida activa, la eliminación borra el usuario de Supabase y, en cascada, perfil, ajustes, clasificación, cola e historial de partidas y movimientos. Esa identidad, valoración e historial no pueden restaurarse.')] },
        { heading: 'Los datos locales permanecen', blocks: [p('La eliminación cierra tu sesión y borra la sesión local de la cuenta y la copia en caché del perfil. No borra las preferencias locales, las estadísticas sin conexión ni los archivos de la aplicación en caché de este dispositivo. Borra el almacenamiento de la aplicación en los ajustes del dispositivo o los datos guardados del sitio en el navegador.')] },
        { heading: 'Solicitar fuera de la aplicación', blocks: [p('Escribe a {{publicEmail}}, si es posible desde el correo confirmado de la cuenta. Solicita eliminar la cuenta para partidas clasificatorias de Knucklebones Neon e indica el apodo solo si hace falta para localizarla.')] },
        { heading: 'Comprobación, registros y copias', blocks: [p('Antes de atender una solicitud externa comprobamos la titularidad así: {{deletionVerification}}. Los registros de seguridad pueden permanecer {{securityLogRetention}} y las copias de seguridad {{backupRetention}} hasta su vencimiento normal.')] },
      ],
    },
  },
};
