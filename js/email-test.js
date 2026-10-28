// Sends a sample confirmation using the EmailJS codes typed on the Settings > Email form.
import { confirmationText } from "./email.js";

export async function sendTestWith(cfg, to, shop) {
  const sample = {
    customerName: "Test Customer", serviceName: "Haircut", barberName: "Your barber",
    date: new Date().toISOString().slice(0, 10), time: "10:00"
  };
  const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: cfg.serviceId, template_id: cfg.templateId, user_id: cfg.publicKey,
      template_params: {
        to_email: to, to_name: sample.customerName, subject: `Test - ${shop.name}`,
        message: confirmationText(sample, shop), shop_name: shop.name,
        service: sample.serviceName, barber: sample.barberName, date: sample.date, time: "10:00 AM"
      }
    })
  });
  if (!res.ok) throw new Error("emailjs-" + res.status);
}
