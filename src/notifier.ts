import nodemailer from 'nodemailer';
import type { GmailConfig, RecipientsConfig } from './config';
import { readFileSync } from 'fs';

/**
 * メール通知を送信する
 */
export async function sendNotification(
  gmailConfig: GmailConfig,
  recipientsConfig: RecipientsConfig,
  screenshotPath: string
): Promise<void> {
  console.log('メール通知を送信しています...');

  // Gmail SMTPトランスポーターを作成
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailConfig.user,
      pass: gmailConfig.password,
    },
  });

  // メール本文
  const mailOptions = {
    from: recipientsConfig.sender,
    to: recipientsConfig.to.join(', '),
    subject: '【JKK Watcher】空き物件が検索されました',
    text: `空き物件が見つかりました！\n\n添付のスクリーンショットをご確認ください。\n\n詳細はこちら:\nhttps://jhomes.to-kousya.or.jp/search/jkknet/service/akiyaJyoukenStartInit`,
    attachments: [
      {
        filename: 'property_screenshot.png',
        content: readFileSync(screenshotPath),
      },
    ],
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('メール送信成功');
  } catch (error) {
    console.error('メール送信エラー:', error);
    throw error;
  }
}