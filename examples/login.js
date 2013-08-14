define(['require', 'text!examples/login.html'],
	function(require, viewTemplate) {

		return Piece.View.extend({

			id: 'login_login',

			render: function() {
				$(this.el).html(viewTemplate);

				Piece.View.prototype.render.call(this);
				return this;
			}
		}); //view define

	});