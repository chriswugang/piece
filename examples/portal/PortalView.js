define(['text!portal/PortalView.html'], function(listViewTemplate) {

    var IndexView = Piece.View.extend({

        id: 'flightstatus-list',

        type: 'portal',

        el: "body",

        events: {
            "click #querymore": "queryMore",
            "click #refresh": "reload",
        },

        bindings: {
            "Segment:change io": "onIOChange",
            "List:select flightstatus-list": "onItemSelect"
        },

        render: function() {
            if (listViewTemplate.indexOf("<body") > -1) {
                listViewTemplate = listViewTemplate.substring(listViewTemplate.indexOf("<body") + 5, listViewTemplate.indexOf("</body>"));
                listViewTemplate = listViewTemplate.substring(listViewTemplate.indexOf(">") + 1, listViewTemplate.length);
            }
            $(this.el).html(listViewTemplate);
            Piece.View.prototype.render.call(this);
            return this;
        },

        onShow: function() {
            // alert("..");
            // $("body").click(function(){
            //     alert("=.=");
            // });
        },

        onItemSelect: function(list, data) {
            this.navigate('detailView', {
                trigger: true
            });
        },

        onGotResult: function(params) {
            alert(params);
        },

        onIOChange: function(comp) {
            var io = comp.getValue();
            console.info("=.=");
        },

        queryMore: function() {
            console.info(this.container);
            this.navigate("detailView", {
                trigger: true
            });
        },

        reload: function() {
            console.info(this.container);
            alert("reload");

        }
    });

    return IndexView;
});