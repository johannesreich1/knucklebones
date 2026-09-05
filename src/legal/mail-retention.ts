import type { LocalizedLegalFact } from './types.ts';

// IONOS AVV, Anhang 1, v3.0 (03/2026), § 2:
// https://www.ionos.de/terms-gtc/fileadmin/pdf/terms-gtc/DE/AVV/Anhang_1_Leistungsbeschreibungen_AVV_IONOS_v.3.0.pdf
const IONOS_MAIL_LOG_DAYS = '28';
const IONOS_MAIL_DELETION_DAYS = '7';

export const IONOS_MAIL_RETENTION: LocalizedLegalFact = {
  en: `IONOS retains email logs for up to ${IONOS_MAIL_LOG_DAYS} days after creation. For stored email-service data, IONOS specifies deletion within ${IONOS_MAIL_DELETION_DAYS} days after our deletion action or after the contract ends.`,
  pt: `A IONOS mantém registros de e-mail por até ${IONOS_MAIL_LOG_DAYS} dias após a criação. Para os dados armazenados do serviço de e-mail, a IONOS prevê a exclusão em até ${IONOS_MAIL_DELETION_DAYS} dias após nossa ação de exclusão ou o término do contrato.`,
  es: `IONOS conserva los registros de correo electrónico hasta ${IONOS_MAIL_LOG_DAYS} días desde su creación. Para los datos almacenados del servicio de correo, IONOS establece su eliminación dentro de los ${IONOS_MAIL_DELETION_DAYS} días siguientes a nuestra acción de borrado o a la finalización del contrato.`,
  de: `IONOS bewahrt E-Mail-Protokolle bis zu ${IONOS_MAIL_LOG_DAYS} Tage nach ihrer Erstellung auf. Für gespeicherte Daten des E-Mail-Dienstes sieht IONOS die Löschung innerhalb von ${IONOS_MAIL_DELETION_DAYS} Tagen nach unserer Löschaktion oder nach Vertragsende vor.`,
  fr: `IONOS conserve les journaux de messagerie jusqu’à ${IONOS_MAIL_LOG_DAYS} jours après leur création. Pour les données stockées du service de messagerie, IONOS prévoit leur suppression dans les ${IONOS_MAIL_DELETION_DAYS} jours suivant notre action de suppression ou la fin du contrat.`,
  it: `IONOS conserva i registri e-mail per un massimo di ${IONOS_MAIL_LOG_DAYS} giorni dalla creazione. Per i dati archiviati del servizio e-mail, IONOS prevede la cancellazione entro ${IONOS_MAIL_DELETION_DAYS} giorni dalla nostra azione di eliminazione o dalla fine del contratto.`,
  pl: `IONOS przechowuje dzienniki poczty elektronicznej przez maksymalnie ${IONOS_MAIL_LOG_DAYS} dni od ich utworzenia. W przypadku przechowywanych danych usługi pocztowej IONOS przewiduje usunięcie w ciągu ${IONOS_MAIL_DELETION_DAYS} dni po wykonaniu przez nas operacji usunięcia lub po zakończeniu umowy.`,
  tr: `IONOS, e-posta günlüklerini oluşturulmalarından itibaren en fazla ${IONOS_MAIL_LOG_DAYS} gün saklar. IONOS, saklanan e-posta hizmeti verilerinin bizim silme işlemimizden veya sözleşmenin sona ermesinden sonraki ${IONOS_MAIL_DELETION_DAYS} gün içinde silinmesini öngörür.`,
  id: `IONOS menyimpan log email hingga ${IONOS_MAIL_LOG_DAYS} hari setelah dibuat. Untuk data layanan email yang disimpan, IONOS menetapkan penghapusan dalam ${IONOS_MAIL_DELETION_DAYS} hari setelah tindakan penghapusan oleh kami atau setelah kontrak berakhir.`,
  ja: `IONOSは、メールのログを作成後最大${IONOS_MAIL_LOG_DAYS}日間保存します。メールサービスで保存されているデータについては、当方が削除操作を行った後、または契約終了後、${IONOS_MAIL_DELETION_DAYS}日以内に削除するとIONOSは定めています。`,
  ko: `IONOS는 이메일 로그를 생성 후 최대 ${IONOS_MAIL_LOG_DAYS}일 동안 보관합니다. 저장된 이메일 서비스 데이터에 대해서는 저희의 삭제 작업 후 또는 계약 종료 후 ${IONOS_MAIL_DELETION_DAYS}일 이내에 삭제한다고 IONOS는 명시합니다.`,
};
